import { makeStyles } from "@material-ui/core/styles"
import { useMachine } from "@xstate/react"
import React from "react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { v4 as uuidv4 } from "uuid"
import * as XTerm from "xterm"
import { FitAddon } from "xterm-addon-fit"
import { WebLinksAddon } from "xterm-addon-web-links"
import "xterm/css/xterm.css"
import { MONOSPACE_FONT_FAMILY } from "../../theme/constants"
import { terminalMachine } from "../../xServices/terminal/terminalXService"

export const Language = {
  organizationsErrorMessagePrefix: "Unable to fetch organizations: ",
  workspaceErrorMessagePrefix: "Unable to fetch workspace: ",
  workspaceAgentErrorMessagePrefix: "Unable to fetch workspace agent: ",
  websocketErrorMessagePrefix: "WebSocket failed: ",
}

const TerminalPage: React.FC<{
  readonly renderer?: XTerm.RendererType
}> = ({ renderer }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const styles = useStyles()
  const { username, workspace } = useParams()
  const xtermRef = React.useRef<HTMLDivElement>(null)
  const [terminal, setTerminal] = React.useState<XTerm.Terminal | null>(null)
  const [fitAddon, setFitAddon] = React.useState<FitAddon | null>(null)
  // The reconnection token is a unique token that identifies
  // a terminal session. It's generated by the client to reduce
  // a round-trip, and must be a UUIDv4.
  const [reconnectionToken] = React.useState<string>(() => {
    const search = new URLSearchParams(location.search)
    return search.get("reconnect") ?? uuidv4()
  })
  const [terminalState, sendEvent] = useMachine(terminalMachine, {
    context: {
      reconnection: reconnectionToken,
      workspaceName: workspace,
      username: username,
    },
    actions: {
      readMessage: (_, event) => {
        if (typeof event.data === "string") {
          // This exclusively occurs when testing.
          // "jest-websocket-mock" doesn't support ArrayBuffer.
          terminal?.write(event.data)
        } else {
          terminal?.write(new Uint8Array(event.data))
        }
      },
    },
  })
  const isConnected = terminalState.matches("connected")
  const isDisconnected = terminalState.matches("disconnected")
  const { organizationsError, workspaceError, workspaceAgentError, workspaceAgent, websocketError } =
    terminalState.context

  // Create the terminal!
  React.useEffect(() => {
    if (!xtermRef.current) {
      return
    }
    const terminal = new XTerm.Terminal({
      allowTransparency: true,
      disableStdin: false,
      fontFamily: MONOSPACE_FONT_FAMILY,
      fontSize: 16,
      theme: {
        // This is a slight off-black.
        // It's really easy on the eyes!
        background: "#1F1F1F",
      },
      rendererType: renderer,
    })
    const fitAddon = new FitAddon()
    setFitAddon(fitAddon)
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.onData((data) => {
      sendEvent({
        type: "WRITE",
        request: {
          data: data,
        },
      })
    })
    terminal.onResize((event) => {
      sendEvent({
        type: "WRITE",
        request: {
          height: event.rows,
          width: event.cols,
        },
      })
    })
    setTerminal(terminal)
    terminal.open(xtermRef.current)
    const listener = () => {
      // This will trigger a resize event on the terminal.
      fitAddon.fit()
    }
    window.addEventListener("resize", listener)
    return () => {
      window.removeEventListener("resize", listener)
      terminal.dispose()
    }
  }, [renderer, sendEvent, xtermRef])

  // Triggers the initial terminal connection using
  // the reconnection token and workspace name found
  // from the router.
  React.useEffect(() => {
    const search = new URLSearchParams(location.search)
    search.set("reconnect", reconnectionToken)
    navigate(
      {
        search: search.toString(),
      },
      {
        replace: true,
      },
    )
  }, [location.search, navigate, reconnectionToken])

  // Apply terminal options based on connection state.
  React.useEffect(() => {
    if (!terminal || !fitAddon) {
      return
    }

    // We have to fit twice here. It's unknown why, but
    // the first fit will overflow slightly in some
    // scenarios. Applying a second fit resolves this.
    fitAddon.fit()
    fitAddon.fit()

    if (!isConnected) {
      // Disable user input when not connected.
      terminal.options = {
        disableStdin: true,
      }
      if (organizationsError instanceof Error) {
        terminal.writeln(Language.organizationsErrorMessagePrefix + organizationsError.message)
      }
      if (workspaceError instanceof Error) {
        terminal.writeln(Language.workspaceErrorMessagePrefix + workspaceError.message)
      }
      if (workspaceAgentError instanceof Error) {
        terminal.writeln(Language.workspaceAgentErrorMessagePrefix + workspaceAgentError.message)
      }
      if (websocketError instanceof Error) {
        terminal.writeln(Language.websocketErrorMessagePrefix + websocketError.message)
      }
      return
    }

    // The terminal should be cleared on each reconnect
    // because all data is re-rendered from the backend.
    terminal.clear()

    // Focusing on connection allows users to reload the
    // page and start typing immediately.
    terminal.focus()
    terminal.options = {
      disableStdin: false,
      windowsMode: workspaceAgent?.operating_system === "windows",
    }

    // Update the terminal size post-fit.
    sendEvent({
      type: "WRITE",
      request: {
        height: terminal.rows,
        width: terminal.cols,
      },
    })
  }, [
    workspaceError,
    organizationsError,
    workspaceAgentError,
    websocketError,
    workspaceAgent,
    terminal,
    fitAddon,
    isConnected,
    sendEvent,
  ])

  return (
    <>
      {/* This overlay makes it more obvious that the terminal is disconnected. */}
      {/* It's nice for situations where Coder restarts, and they are temporarily disconnected. */}
      <div className={`${styles.overlay} ${isDisconnected ? "" : "connected"}`}>
        <span>Disconnected</span>
      </div>
      <div className={styles.terminal} ref={xtermRef} data-testid="terminal" />
    </>
  )
}

export default TerminalPage

const useStyles = makeStyles(() => ({
  overlay: {
    position: "absolute",
    pointerEvents: "none",
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    zIndex: 1,
    alignItems: "center",
    justifyContent: "center",
    display: "flex",
    color: "white",
    fontFamily: MONOSPACE_FONT_FAMILY,
    fontSize: 18,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    "&.connected": {
      opacity: 0,
    },
  },
  terminal: {
    width: "100vw",
    height: "100vh",
    overflow: "hidden",
    // These styles attempt to mimic the VS Code scrollbar.
    "& .xterm": {
      padding: 4,
      width: "100vw",
      height: "100vh",
    },
    "& .xterm-viewport": {
      // This is required to force full-width on the terminal.
      // Otherwise there's a small white bar to the right of the scrollbar.
      width: "auto !important",
    },
    "& .xterm-viewport::-webkit-scrollbar": {
      width: "10px",
    },
    "& .xterm-viewport::-webkit-scrollbar-track": {
      backgroundColor: "inherit",
    },
    "& .xterm-viewport::-webkit-scrollbar-thumb": {
      minHeight: 20,
      backgroundColor: "rgba(255, 255, 255, 0.18)",
    },
  },
}))
