import React from "react";
import Button from "@material-ui/core/Button";
import Typography from "@material-ui/core/Typography";
import WhatsAppIcon from "@material-ui/icons/WhatsApp";
import RefreshIcon from "@material-ui/icons/Refresh";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[GlobalErrorBoundary] Uncaught application error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: "100vh",
            width: "100vw",
            backgroundColor: "#0b141a",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            color: "#e9edef",
            fontFamily: "Segoe UI, Helvetica Neue, Helvetica, Lucida Grande, Arial, sans-serif",
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "50%",
              backgroundColor: "#111b21",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 24,
              border: "1px solid #202c33",
            }}
          >
            <WhatsAppIcon style={{ fontSize: 44, color: "#00a884" }} />
          </div>

          <Typography variant="h5" style={{ fontWeight: 600, marginBottom: 12, color: "#e9edef" }}>
            Anubis Store • WhatsApp Desktop
          </Typography>

          <Typography variant="body1" style={{ color: "#8696a0", maxWidth: 500, marginBottom: 28, lineHeight: 1.6 }}>
            Se detectó un cambio de estado en el chat. Puedes reanudar la sesión instantáneamente haciendo clic en el botón inferior.
          </Typography>

          <div style={{ display: "flex", gap: 12 }}>
            <Button
              variant="contained"
              startIcon={<RefreshIcon />}
              onClick={this.handleReload}
              style={{
                backgroundColor: "#00a884",
                color: "#111b21",
                fontWeight: 700,
                textTransform: "none",
                padding: "10px 24px",
                borderRadius: 8,
              }}
            >
              Recargar Chats
            </Button>
            <Button
              variant="outlined"
              onClick={this.handleReset}
              style={{
                color: "#8696a0",
                borderColor: "#202c33",
                textTransform: "none",
                padding: "10px 20px",
                borderRadius: 8,
              }}
            >
              Reintentar
            </Button>
          </div>

          {process.env.NODE_ENV !== "production" && this.state.error && (
            <div
              style={{
                marginTop: 32,
                maxWidth: 600,
                textAlign: "left",
                backgroundColor: "#111b21",
                padding: 16,
                borderRadius: 8,
                border: "1px solid #202c33",
                fontSize: "0.8rem",
                color: "#ff6b6b",
                overflowX: "auto",
              }}
            >
              <strong>Error:</strong> {this.state.error.toString()}
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
