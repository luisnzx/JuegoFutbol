param([int]$Port = 8000)

$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("http://localhost:$Port/")
$Listener.Start()
Write-Host "Server running at http://localhost:$Port/" -ForegroundColor Green

while ($Listener.IsListening) {
    $Context = $Listener.GetContext()
    $Request = $Context.Request
    $Response = $Context.Response
    
    $FilePath = "$PSScriptRoot$($Request.Url.LocalPath)"
    if ($FilePath -eq "$PSScriptRoot/") { $FilePath = "$PSScriptRoot/game.html" }
    
    if (Test-Path $FilePath -PathType Leaf) {
        $File = Get-Item $FilePath
        $Response.ContentType = if ($File.Extension -eq ".js") { "application/javascript" }
                                elseif ($File.Extension -eq ".html") { "text/html" }
                                elseif ($File.Extension -eq ".json") { "application/json" }
                                else { "application/octet-stream" }
        
        $FileStream = [System.IO.File]::OpenRead($FilePath)
        $FileStream.CopyTo($Response.OutputStream)
        $FileStream.Close()
        $Response.StatusCode = 200
    } else {
        $Response.StatusCode = 404
        $Response.OutputStream.Write([System.Text.Encoding]::UTF8.GetBytes("404 Not Found"), 0, 14)
    }
    
    $Response.Close()
}
