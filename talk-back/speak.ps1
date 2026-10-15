# talk-back worker: WinRT speech synthesis for OpenCode.
#
# Reads JSON lines on stdin and writes JSON lines on stdout.
#
# On startup it emits {"ev":"ready","voices":[{"name":"...","id":"...","engine":"winrt|sapi"}]}.
#
# Requests:
#   {"id":"1","cmd":"speak","text":"...","voice":"Microsoft Mark","rate":0}
#   {"id":"2","cmd":"stop"}
#   {"cmd":"shutdown"}
#
# Responses:
#   {"id":"1","ev":"started"}
#   {"id":"1","ev":"done"}
#   {"id":"2","ev":"stopped"}
#   {"id":"*","ev":"error","message":"..."}
#
# Playback is sequential and blocking on purpose: the plugin stops playback by
# killing this process, so no cross-thread cancellation is needed.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and
  $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq "IAsyncOperation``1"
})[0]

function Await($operation, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait(-1) | Out-Null
  $task.Result
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$player = New-Object System.Media.SoundPlayer
# SAPI5 engine. It reaches classic "Desktop" voices and, more importantly, any
# voice bridged into SAPI by a third-party driver (e.g. Narrator "Natural"
# voices exposed through NaturalVoiceSAPIAdapter). Those never show up in the
# WinRT AllVoices collection, so both engines have to be enumerated.
try {
  Add-Type -AssemblyName System.Speech
  $sapi = New-Object System.Speech.Synthesis.SpeechSynthesizer
} catch {
  $sapi = $null
}
# Per-process temp file so parallel OpenCode instances cannot clobber each other.
$wav = Join-Path $env:TEMP "opencode-talk-back-$PID.wav"

# name -> @{ engine = "winrt"; voice = <VoiceInformation>; id = "..." }
#      or @{ engine = "sapi";  name  = "...";             id = "..." }
# WinRT wins display-name collisions; SAPI contributes voices WinRT cannot see.
$index = @{}
foreach ($voice in [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices) {
  $index[$voice.DisplayName] = @{ engine = "winrt"; voice = $voice; id = $voice.Id }
}
if ($sapi) {
  foreach ($installed in $sapi.GetInstalledVoices()) {
    if (-not $installed.Enabled) { continue }
    $info = $installed.VoiceInfo
    if ($index.ContainsKey($info.Name)) { continue }
    $index[$info.Name] = @{ engine = "sapi"; name = $info.Name; id = $info.Id }
  }
}

function Emit($payload) {
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress -Depth 5))
  [Console]::Out.Flush()
}

# Announce the voice list once, up front, so the plugin never has to ask while
# the worker is busy speaking.
$available = @()
foreach ($name in ($index.Keys | Sort-Object)) {
  $entry = $index[$name]
  $available += @{ name = $name; id = $entry.id; engine = $entry.engine }
}
Emit @{ ev = "ready"; voices = $available }

function Chunk([string]$text) {
  $chunks = New-Object System.Collections.Generic.List[string]
  $buffer = ""
  foreach ($part in [regex]::Split($text, "(?<=[\.\!\?\:])\s+")) {
    if ($part.Trim().Length -eq 0) { continue }
    if ($buffer.Length -gt 0 -and ($buffer.Length + $part.Length) -gt 600) {
      $chunks.Add($buffer)
      $buffer = $part
    } elseif ($buffer.Length -eq 0) {
      $buffer = $part
    } else {
      $buffer = "$buffer $part"
    }
  }
  if ($buffer.Length -gt 0) { $chunks.Add($buffer) }
  if ($chunks.Count -eq 0) { $chunks.Add($text) }
  return $chunks
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }

  $id = $null
  try {
    $request = $line | ConvertFrom-Json
    $id = $request.id

    switch ($request.cmd) {
      "speak" {
        $entry = $null
        if ($request.voice) { $entry = $index[[string]$request.voice] }
        $useSapi = $entry -and $entry.engine -eq "sapi" -and $sapi

        $rate = 1.0
        if ($null -ne $request.rate) {
          $rate = [Math]::Max(0.5, [Math]::Min(2.0, 1 + ([double]$request.rate / 10)))
        }
        $rateText = $rate.ToString([System.Globalization.CultureInfo]::InvariantCulture)
        if ($useSapi) {
          # SAPI already takes an integer -10..10, which is the plugin's own scale.
          $sapiRate = 0
          if ($null -ne $request.rate) { $sapiRate = [Math]::Max(-10, [Math]::Min(10, [int][double]$request.rate)) }
          $sapi.SelectVoice($entry.name)
          $sapi.Rate = $sapiRate
        } elseif ($entry) {
          $synth.Voice = $entry.voice
        }
        $lang = "en-US"
        try { if ($synth.Voice.Language) { $lang = $synth.Voice.Language } } catch { }

        Emit @{ id = $id; ev = "started" }
        foreach ($chunk in (Chunk ([string]$request.text))) {
          if ($useSapi) {
            # Speak() blocks until playback completes; stop() kills the process.
            $sapi.Speak($chunk)
            continue
          }
          $escaped = [System.Security.SecurityElement]::Escape($chunk)
          $ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="' + $lang + '"><prosody rate="' + $rateText + '">' + $escaped + "</prosody></speak>"
          $stream = Await ($synth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
          $reader = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
          $file = [System.IO.File]::Create($wav)
          $reader.CopyTo($file)
          $file.Dispose()
          $reader.Dispose()
          $player.SoundLocation = $wav
          $player.PlaySync()
        }
        Emit @{ id = $id; ev = "done" }
      }

      "stop" {
        try { $player.Stop() } catch { }
        Emit @{ id = $id; ev = "stopped" }
      }

      "shutdown" {
        try { $player.Stop() } catch { }
        exit 0
      }

      default {
        Emit @{ id = $id; ev = "error"; message = "unknown cmd: $($request.cmd)" }
      }
    }
  } catch {
    Emit @{ id = $id; ev = "error"; message = $_.Exception.Message }
  }
}
