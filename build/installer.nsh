; Custom NSIS installer script
; This file is included in the installer to add custom functionality

!macro customHeader
  !system "echo 'Custom NSIS header'"
!macroend

!macro preInit
  ; Custom initialization
  !system "echo 'Pre-init'"
!macroend

!macro customInit
  ; Custom initialization code
!macroend

!macro customInstall
  ; Add to PATH for command line usage
  EnVar::AddValue "PATH" "$INSTDIR"
  Pop $0

  ; Register custom URL protocol
  WriteRegStr HKCR "gitlab-auto-deploy" "" "URL:GitLab Auto Deploy Protocol"
  WriteRegStr HKCR "gitlab-auto-deploy" "URL Protocol" ""
  WriteRegStr HKCR "gitlab-auto-deploy\shell\open\command" "" '"$INSTDIR\GitLab Auto Deploy.exe" "%1"'
!macroend

!macro customUnInstall
  ; Remove from PATH
  EnVar::DeleteValue "PATH" "$INSTDIR"
  Pop $0

  ; Remove URL protocol registration
  DeleteRegKey HKCR "gitlab-auto-deploy"
!macroend