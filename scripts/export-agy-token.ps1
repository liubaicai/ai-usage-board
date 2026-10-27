# 从 Windows 凭据管理器读出 Antigravity（agy CLI）的 Google OAuth 凭据。
# 输出就是 ai-usage-board「agy 登录 token JSON」字段要粘贴的内容。
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\export-agy-token.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\export-agy-token.ps1 -WithSecret   # 同时给出 client_secret
#
# -WithSecret 会从本机 agy.exe 里取出它自带的 OAuth client_secret 一并打印。
# 该值是你的本机数据，不会写进仓库；填进账号的「Client Secret」后
# refresh_token 才能自动续期（否则 access_token 过期 1 小时后就会报错）。
param(
  [switch]$WithSecret,
  [string]$AgyExe = "$env:LOCALAPPDATA\agy\bin\agy.exe",
  # 需要走代理时显式指定；留空则用系统/环境代理设置
  [string]$Proxy = $env:HTTPS_PROXY
)

$ErrorActionPreference = 'Stop'

$sig = @'
using System;
using System.Runtime.InteropServices;
public class AgyCred {
  [DllImport("advapi32", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32")] public static extern void CredFree(IntPtr cred);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
  }
}
'@
Add-Type -TypeDefinition $sig

# agy 在 Windows 上把凭据存成「通用凭据」，名称为 gemini:antigravity，密码框就是 JSON。
$p = [IntPtr]::Zero
if (-not [AgyCred]::CredRead('gemini:antigravity', 1, 0, [ref]$p)) {
  Write-Error '没有找到凭据 gemini:antigravity —— 请先运行一次 agy 并完成 Google 登录。'
  exit 1
}
$c = [Runtime.InteropServices.Marshal]::PtrToStructure($p, [type][AgyCred+CREDENTIAL])
$blob = [byte[]]::new($c.CredentialBlobSize)
[Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $blob, 0, $c.CredentialBlobSize)
[AgyCred]::CredFree($p)
$json = [Text.Encoding]::UTF8.GetString($blob)

Write-Output $json

if ($WithSecret) {
  if (-not (Test-Path $AgyExe)) {
    Write-Warning "找不到 $AgyExe，无法提取 client_secret。"
    exit 0
  }
  # agy 二进制里内嵌了若干 GOCSPX- 前缀的 OAuth client_secret，逐个试刷新，
  # 能成功续期的那个才是当前 client_id 对应的 secret。
  # PowerShell 5.1 没有 [Text.Encoding]::Latin1，用 ISO-8859-1（28591）按字节直读。
  $latin1 = [Text.Encoding]::GetEncoding(28591)
  $txt = $latin1.GetString([IO.File]::ReadAllBytes($AgyExe))
  $cands = [regex]::Matches($txt, 'GOCSPX-[A-Za-z0-9_\-]{28}') |
    ForEach-Object { $_.Value } | Select-Object -Unique

  $cred = $json | ConvertFrom-Json
  $inner = if ($cred.token) { $cred.token } else { $cred }
  $cid = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com'
  if ($cred.client_id) { $cid = $cred.client_id }

  foreach ($s in $cands) {
    $body = "client_id=$cid&client_secret=$([uri]::EscapeDataString($s))" +
            "&refresh_token=$([uri]::EscapeDataString($inner.refresh_token))&grant_type=refresh_token"
    $params = @{
      Method      = 'Post'
      Uri         = 'https://oauth2.googleapis.com/token'
      Body        = $body
      ContentType = 'application/x-www-form-urlencoded'
      TimeoutSec  = 30
    }
    if ($Proxy) { $params.Proxy = $Proxy }
    try {
      Invoke-RestMethod @params | Out-Null
      Write-Output ''
      Write-Output "# ---- Client Secret（验证可续期，填进账号的 Client Secret 或环境变量 ANTIGRAVITY_CLIENT_SECRET）----"
      Write-Output $s
      exit 0
    } catch {
      continue
    }
  }
  Write-Warning '未能从 agy.exe 中验证出可用的 client_secret。'
}
