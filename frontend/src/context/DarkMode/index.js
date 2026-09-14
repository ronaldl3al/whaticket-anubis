import React, { createContext, useState, useContext, useMemo } from "react";
import PropTypes from "prop-types";
import { createMuiTheme, ThemeProvider as MUIThemeProvider } from "@material-ui/core/styles";
import { CssBaseline } from "@material-ui/core";

const ThemeContext = createContext();

export const THEME_PRESETS = {
  anubis: {
    id: "anubis",
    name: "Anubis Dark Gold (Por defecto)",
    primary: "#B58863",
    secondary: "#B58863",
    background: "#10232A",
    paper: "#161616",
    panelBg: "#1a2e36",
    textPrimary: "#D3C3B9",
    textSecondary: "#A79E9C",
    border: "#3D4D55",
    deepNavy: "#10232A",
    slateGray: "#3D4D55",
    warmGray: "#A79E9C",
    warmBeige: "#D3C3B9",
    goldAccent: "#B58863",
    pureBlack: "#161616",
  },
  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp Dark Clásico",
    primary: "#00a884",
    secondary: "#00a884",
    background: "#0b141a",
    paper: "#111b21",
    panelBg: "#202c33",
    textPrimary: "#e9edef",
    textSecondary: "#8696a0",
    border: "#2a3942",
    deepNavy: "#0b141a",
    slateGray: "#202c33",
    warmGray: "#8696a0",
    warmBeige: "#e9edef",
    goldAccent: "#00a884",
    pureBlack: "#0b141a",
  },
  midnight: {
    id: "midnight",
    name: "Midnight Blue Cyber",
    primary: "#3b82f6",
    secondary: "#60a5fa",
    background: "#090d16",
    paper: "#111827",
    panelBg: "#1e293b",
    textPrimary: "#f1f5f9",
    textSecondary: "#94a3b8",
    border: "#334155",
    deepNavy: "#090d16",
    slateGray: "#1e293b",
    warmGray: "#94a3b8",
    warmBeige: "#f1f5f9",
    goldAccent: "#3b82f6",
    pureBlack: "#070a10",
  },
  onyx: {
    id: "onyx",
    name: "Onyx Pitch Black",
    primary: "#e5a93c",
    secondary: "#e5a93c",
    background: "#000000",
    paper: "#121212",
    panelBg: "#1e1e1e",
    textPrimary: "#f5f5f5",
    textSecondary: "#8e8e8e",
    border: "#282828",
    deepNavy: "#000000",
    slateGray: "#1e1e1e",
    warmGray: "#8e8e8e",
    warmBeige: "#f5f5f5",
    goldAccent: "#e5a93c",
    pureBlack: "#000000",
  },
};

export const ThemeProvider = ({ children }) => {
  const [darkMode, setDarkMode] = useState(true);
  const [presetKey, setPresetKey] = useState(() => {
    return localStorage.getItem("anubis_theme_preset") || "anubis";
  });
  const [customAccent, setCustomAccent] = useState(() => {
    return localStorage.getItem("anubis_custom_accent") || "";
  });

  const activePreset = useMemo(() => {
    const base = THEME_PRESETS[presetKey] || THEME_PRESETS.anubis;
    if (customAccent) {
      return {
        ...base,
        primary: customAccent,
        goldAccent: customAccent,
      };
    }
    return base;
  }, [presetKey, customAccent]);

  const changePreset = (key) => {
    if (THEME_PRESETS[key]) {
      setPresetKey(key);
      localStorage.setItem("anubis_theme_preset", key);
    }
  };

  const changeCustomAccent = (hex) => {
    setCustomAccent(hex);
    if (hex) {
      localStorage.setItem("anubis_custom_accent", hex);
    } else {
      localStorage.removeItem("anubis_custom_accent");
    }
  };

  const toggleTheme = () => {
    setDarkMode((prev) => !prev);
  };

  const theme = useMemo(
    () =>
      createMuiTheme({
        palette: {
          type: darkMode ? "dark" : "light",
          primary: {
            main: activePreset.primary,
          },
          secondary: {
            main: activePreset.secondary,
          },
          background: {
            default: darkMode ? activePreset.background : "#fafafa",
            paper: darkMode ? activePreset.paper : "#ffffff",
          },
          text: {
            primary: darkMode ? activePreset.textPrimary : "rgba(0, 0, 0, 0.87)",
            secondary: darkMode ? activePreset.textSecondary : "rgba(0, 0, 0, 0.54)",
          },
          divider: darkMode ? activePreset.border : "rgba(0, 0, 0, 0.12)",
        },
        anubis: activePreset,
        scrollbarStyles: {
          "&::-webkit-scrollbar": {
            width: "6px",
            height: "6px",
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: darkMode ? activePreset.background : "#f0f0f0",
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: darkMode ? activePreset.slateGray : "#c1c1c1",
            borderRadius: "3px",
          },
          "&::-webkit-scrollbar-thumb:hover": {
            backgroundColor: darkMode ? activePreset.warmGray : "#a8a8a8",
          },
        },
        overrides: {
          MuiListItem: {
            root: {
              "&.Mui-selected": {
                backgroundColor: darkMode ? activePreset.slateGray : undefined,
              },
            },
          },
          MuiDivider: {
            root: {
              backgroundColor: darkMode ? activePreset.border : undefined,
            },
          },
        },
      }),
    [darkMode, activePreset]
  );

  const contextValue = useMemo(
    () => ({
      darkMode,
      toggleTheme,
      presetKey,
      changePreset,
      customAccent,
      changeCustomAccent,
      activePreset,
      presets: THEME_PRESETS,
    }),
    [darkMode, presetKey, customAccent, activePreset]
  );

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
