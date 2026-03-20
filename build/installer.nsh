; Custom NSIS installer script
; This file is included in the installer to add custom functionality

!macro customHeader
  ; Custom header
!macroend

!macro preInit
  ; Custom initialization
!macroend

!macro customInit
  ; Custom initialization code
!macroend

!macro customInstall
  ; Register custom URL protocol
  WriteRegStr HKCR "gitlab-auto-deploy" "" "URL:GitLab Auto Deploy Protocol"
  WriteRegStr HKCR "gitlab-auto-deploy" "URL Protocol" ""
  WriteRegStr HKCR "gitlab-auto-deploy\shell\open\command" "" '"$INSTDIR\GitLab Auto Deploy.exe" "%1"'
!macroend

!macro customUnInstall
  ; Remove URL protocol registration
  DeleteRegKey HKCR "gitlab-auto-deploy"
!macroend