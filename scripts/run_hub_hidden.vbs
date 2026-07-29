' Starts the PDX Mod Hub server without a console window.
' Put a shortcut to this file in shell:startup for autostart.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
shell.Run "cmd /c npm run start", 0, False
