; Adds and removes the "Open with Morpheus" entry in the Windows Explorer
; context menu for any file. Uses HKCU so a per-user install does not need
; administrator rights.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\*\shell\OpenWithMorpheus" "" "Open with Morpheus"
  WriteRegStr HKCU "Software\Classes\*\shell\OpenWithMorpheus" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr HKCU "Software\Classes\*\shell\OpenWithMorpheus\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\OpenWithMorpheus"
!macroend
