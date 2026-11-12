# Personal interactive Bash customizations. Omarchy initializes before this file.

case ":$PATH:" in
*":$HOME/.local/bin:"*) ;;
*) export PATH="$HOME/.local/bin:$PATH" ;;
esac

# Load Angular CLI autocompletion.
# source <(ng completion script)

alias code='codium'

alias dev='tmuxp load laptop-dev'
alias ddev='tmuxp load laptop-docker-dev'
alias adev='tmuxp load laptop-ai-dev'
alias dadev='tmuxp load laptop-ai-docker-dev'

alias tdev='tmuxp load tablet-dev'
alias tddev='tmuxp load tablet-docker-dev'
alias tadev='tmuxp load tablet-ai-dev'
alias tdadev='tmuxp load tablet-ai-docker-dev'

alias edit='NVIM_APPNAME=nvim-ghoul nvim'
alias mdedit='NVIM_APPNAME=nvim-markdown nvim'

alias serve='npx live-server --host=0.0.0.0 --port=5500 --no-browser'
alias tailnet-serve='npx live-server --host="$(tailscale ip -4)" --port=5500 --no-browser'

alias editrc='nvim ~/.bashrc'
alias rsource='source ~/.bashrc'

alias virt-manager='/usr/bin/python /usr/bin/virt-manager'

# OpenCode TUI connects to the persistent local server. Credentials remain in
# the user-managed ~/.config/opencode/server.env file.
opencode() {
  case "${1:-}" in
  serve | upgrade | auth | session | api | models | mcp | debug | --version | -v | --help | -h)
    command opencode "$@"
    ;;
  *)
    (
      if [[ -f "$HOME/.config/opencode/server.env" ]]; then
        source "$HOME/.config/opencode/server.env"
        export OPENCODE_PASSWORD
      fi
      command opencode --server http://127.0.0.1:4096 "$@"
    )
    ;;
  esac
}
