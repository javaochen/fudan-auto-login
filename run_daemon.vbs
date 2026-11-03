' 无窗口在后台启动保活守护，供开机自启或手动双击使用。
' 账号密码在首次运行时从 Windows 用户环境变量 FUDAN_USERNAME / FUDAN_PASSWORD 读取。
Dim fso, baseDir, shell, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = baseDir
cmd = "python """ & baseDir & "\fudan_auto_login.py"" --service icourse --daemon --interval 1200 --log-file """ & baseDir & "\fudan_daemon.log"""
shell.Run cmd, 0, False
