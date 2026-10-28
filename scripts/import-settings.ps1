# Builds a settings-import link for the LLM Usage Glance options page and opens it in a browser.
# Tokens are read from the relay credentials file and never written to stdout/logs/errors.
param(
  [Parameter(Mandatory = $true)][string]$Browser,        # browser executable path (chrome.exe / Aside.exe)
  [ValidateSet('relay', 'secondary')][string]$Mode = 'relay',
  [string]$Label = 'main',                               # account label for -Mode relay
  [string]$Profile = '',                                 # e.g. 'Profile 1'; empty = default profile
  [string]$CredentialsPath = "$env:LOCALAPPDATA\LLMUsagePhone\credentials.json",
  [string]$ExtensionId = 'ilpoepfbakaakadekkefmfpngppihanp',
  [switch]$NoOpen                                        # build only; do not launch the browser
)
$ErrorActionPreference = "Stop"
$credentials = Get-Content -Raw -LiteralPath $CredentialsPath | ConvertFrom-Json
if (-not $credentials.writeToken -or -not $credentials.readToken) { throw "credentials file is missing tokens" }
if ($Label -notmatch '^[A-Za-z0-9_-]{1,40}$') { throw "label contains unsupported characters" }
$payload = if ($Mode -eq 'relay') {
  [ordered]@{ relay = [ordered]@{ enabled = $true; accountLabel = $Label; writeToken = [string]$credentials.writeToken } }
} else {
  [ordered]@{ secondary = [ordered]@{ enabled = $true; readToken = [string]$credentials.readToken } }
}
$json = $payload | ConvertTo-Json -Compress
$bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
$b64 = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$url = "chrome-extension://$ExtensionId/options.html#import=$b64"
$browserArgs = @()
$q = [char]34
if ($Profile) { $browserArgs += $q + '--profile-directory=' + $Profile + $q }  # quoted: profile names contain spaces
$browserArgs += $q + $url + $q
if ($NoOpen) {
  "OK: built $Mode import link (label: $Label); url: $($url.Length) chars (masked); browser args: $((($browserArgs | Where-Object { $_ -notlike '*chrome-extension://*' }) -join ' ~ ')); -NoOpen set, browser not launched."
  exit 0
}
Start-Process -FilePath $Browser -ArgumentList $browserArgs
"OK: opened $Mode import link (label: $Label) in $([System.IO.Path]::GetFileName($Browser))" + $(if ($Profile) { " profile $Profile" } else { " default profile" })