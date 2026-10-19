; Extra steps for the Windows installer (electron-builder includes this file).

!macro customHeader
  ; WORKAROUND for a crash in the installer's own start-up code (electron-builder 24 / NSIS 3.0.4.1).
  ;
  ; The first thing the installer does for a per-user install is ask Windows where the "Programs" folder is
  ; (SHGetKnownFolderPath). Windows hands back a small block of memory with the folder's name in it, and the
  ; installer then copies NSIS_MAX_STRLEN (8192) wide characters, that is 16 KB, out of that block. When the block
  ; sits near the end of the memory Windows has mapped for it, the copy runs off the end and the installer dies with
  ; an access violation in System.dll before its window ever shows. It depends on where in memory the block lands,
  ; so it happens on some starts and not on others (about 7 in 10 here, on Windows 11 25H2).
  ;
  ; Asking for a folder that does not exist makes that call fail, and the installer then keeps the default it had
  ; already set one line earlier: %LOCALAPPDATA%\Programs. That is the same place for everyone who has not moved
  ; that folder, and the install location can still be changed on the directory page.
  !undef FOLDERID_UserProgramFiles
  !define FOLDERID_UserProgramFiles {00000000-0000-0000-0000-000000000000}
!macroend

!macro customInstall
  ; electron-builder copies the installer itself into %LOCALAPPDATA%\<package name>-updater, for differential updates
  ; through electron-updater, which this app does not use. Take the copy out again, so 75 MB are not left behind
  ; (the uninstaller does not remove it).
  Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  RMDir "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"
!macroend

!macro customUnInstall
  ; Clear that folder too, for installs made before this installer removed the copy itself.
  RMDir /r "$LOCALAPPDATA\${APP_PACKAGE_NAME}-updater"

  ; The uninstaller runs with the install folder as its working folder, which stops that (by now empty) folder from
  ; being removed. Move out of it and remove it.
  SetOutPath $TEMP
  RMDir "$INSTDIR"

  ; The app can start with Windows. Take that entry out too, so nothing is left pointing at a program that is gone.
  ; (The name is the app's id; the product name is there in case an older build used it.)
  ; Not when this is an update: the new installer runs this uninstaller with --updated and the program is about to be
  ; back, so the person's choice to start with Windows has to survive it.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.adhyanmavuri.autostepclimb"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Auto Step Climb"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.adhyanmavuri.autostepclimb"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Auto Step Climb"
  ${endIf}
!macroend
