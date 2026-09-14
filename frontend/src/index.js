import React from "react";
import ReactDOM from "react-dom";
import CssBaseline from "@material-ui/core/CssBaseline";

import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";

ReactDOM.render(
	<CssBaseline>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</CssBaseline>,
	document.getElementById("root")
);

// ReactDOM.render(
// 	<React.StrictMode>
// 		<CssBaseline>
// 			<App />
// 		</CssBaseline>,
//   </React.StrictMode>

// 	document.getElementById("root")
// );
