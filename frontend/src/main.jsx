import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./shared/styles/index.css"
import { initTheme } from "./shared/theme"
import { registerSW } from "./shared/pwa"

initTheme()
registerSW()

ReactDOM.createRoot(document.getElementById("root")).render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
)
