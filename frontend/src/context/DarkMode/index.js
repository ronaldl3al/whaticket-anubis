import React, { createContext, useState, useContext, useMemo } from "react";
import PropTypes from "prop-types";
import { createMuiTheme, ThemeProvider as MUIThemeProvider } from "@material-ui/core/styles";
import { CssBaseline } from "@material-ui/core";

const ThemeContext = createContext();

// Anubis Store Color Palette
const anubisColors = {
  deepNavy: "#10232A",
  slateGray: "#3D4D55",
  warmGray: "#A79E9C",
  warmBeige: "#D3C3B9",
  goldAccent: "#B58863",
  pureBlack: "#161616",
  panelBg: "#1a2e36",
  bubbleRight: "#1a3a4a",
  quotedLeft: "#2a3a42",
  quotedRight: "#15303e",
};

export const ThemeProvider = ({ children }) => {
  const [darkMode, setDarkMode] = useState(true);

  const toggleTheme = () => {
    setDarkMode((prevMode) => !prevMode);
  };

  const theme = useMemo(
    () =>
      createMuiTheme({
        palette: {
          type: darkMode ? "dark" : "light",
          primary: {
            main: darkMode ? anubisColors.goldAccent : "#2576d2",
          },
          secondary: {
            main: darkMode ? anubisColors.goldAccent : "#f50057",
          },
          background: {
            default: darkMode ? anubisColors.deepNavy : "#fafafa",
            paper: darkMode ? anubisColors.panelBg : "#ffffff",
          },
          text: {
            primary: darkMode ? anubisColors.warmBeige : "rgba(0, 0, 0, 0.87)",
            secondary: darkMode ? anubisColors.warmGray : "rgba(0, 0, 0, 0.54)",
          },
          divider: darkMode ? "rgba(61,77,85,0.5)" : "rgba(0, 0, 0, 0.12)",
        },
        anubis: anubisColors,
        scrollbarStyles: {
          "&::-webkit-scrollbar": {
            width: "6px",
            height: "6px",
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: darkMode ? anubisColors.deepNavy : "#f0f0f0",
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: darkMode ? anubisColors.slateGray : "#c1c1c1",
            borderRadius: "3px",
          },
          "&::-webkit-scrollbar-thumb:hover": {
            backgroundColor: darkMode ? anubisColors.warmGray : "#a8a8a8",
          },
        },
        overrides: {
          MuiListItem: {
            root: {
              "&.Mui-selected": {
                backgroundColor: darkMode ? anubisColors.slateGray : undefined,
              },
            },
          },
          MuiDivider: {
            root: {
              backgroundColor: darkMode ? "rgba(61,77,85,0.5)" : undefined,
            },
          },
        },
      }),
    [darkMode]
  );

  const contextValue = useMemo(() => ({ darkMode, toggleTheme }), [darkMode]);

  return (
    <ThemeContext.Provider value={contextValue}>
      <MUIThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MUIThemeProvider>
    </ThemeContext.Provider>
  );
};
ThemeProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export const useThemeContext = () => useContext(ThemeContext);
