import React, { useState, useEffect } from "react";
import openSocket from "../../services/socket-io";

import { makeStyles } from "@material-ui/core/styles";
import Paper from "@material-ui/core/Paper";
import Typography from "@material-ui/core/Typography";
import Container from "@material-ui/core/Container";
import Select from "@material-ui/core/Select";
import TextField from "@material-ui/core/TextField";
import Grid from "@material-ui/core/Grid";
import Button from "@material-ui/core/Button";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import PaletteIcon from "@material-ui/icons/Palette";
import { toast } from "react-toastify";

import api from "../../services/api";
import { i18n } from "../../translate/i18n.js";
import toastError from "../../errors/toastError";
import { useThemeContext } from "../../context/DarkMode";

const useStyles = makeStyles(theme => ({
	root: {
		display: "flex",
		alignItems: "center",
		padding: theme.spacing(4, 4, 6),
	},

	paper: {
		padding: theme.spacing(2.5),
		marginBottom: 16,
		backgroundColor: "#161616",
		border: "1px solid rgba(61, 77, 85, 0.4)",
		borderRadius: 10,
	},

	settingOption: {
		marginLeft: "auto",
	},

	paletteCard: {
		padding: theme.spacing(2),
		borderRadius: 8,
		cursor: "pointer",
		border: "2px solid transparent",
		transition: "all 0.2s ease",
		display: "flex",
		flexDirection: "column",
		gap: 8,
		"&:hover": {
			borderColor: "#B58863",
		},
	},

	paletteCardActive: {
		borderColor: "#B58863 !important",
		boxShadow: "0 0 12px rgba(181, 136, 99, 0.3)",
	},

	swatchRow: {
		display: "flex",
		gap: 6,
		marginTop: 6,
	},

	swatchCircle: {
		width: 22,
		height: 22,
		borderRadius: "50%",
		border: "1px solid rgba(255,255,255,0.2)",
	},
}));

const Settings = () => {
	const classes = useStyles();
	const { presetKey, changePreset, customAccent, changeCustomAccent, presets } = useThemeContext();

	const [settings, setSettings] = useState([]);
	const [accentInput, setAccentInput] = useState(customAccent || "");

	useEffect(() => {
		const fetchSession = async () => {
			try {
				const { data } = await api.get("/settings");
				setSettings(data);
			} catch (err) {
				toastError(err);
			}
		};
		fetchSession();
	}, []);

	useEffect(() => {
		const socket = openSocket();

		socket.on("settings", data => {
			if (data.action === "update") {
				setSettings(prevState => {
					const aux = [...prevState];
					const settingIndex = aux.findIndex(s => s.key === data.setting.key);
					if (settingIndex !== -1) {
						aux[settingIndex].value = data.setting.value;
					}
					return aux;
				});
			}
		});

		return () => {
			socket.disconnect();
		};
	}, []);

	const handleChangeSetting = async e => {
		const selectedValue = e.target.value;
		const settingKey = e.target.name;

		try {
			await api.put(`/settings/${settingKey}`, {
				value: selectedValue,
			});
			toast.success(i18n.t("settings.success"));
		} catch (err) {
			toastError(err);
		}
	};

	const getSettingValue = key => {
		const found = settings.find(s => s.key === key);
		return found ? found.value : "";
	};

	const handleApplyCustomAccent = () => {
		changeCustomAccent(accentInput);
		toast.success("Color de acento aplicado con éxito");
	};

	const handleResetAccent = () => {
		setAccentInput("");
		changeCustomAccent("");
		toast.info("Acento restablecido al predeterminado de la paleta");
	};

	return (
		<div className={classes.root}>
			<Container className={classes.container} maxWidth="md">
				{/* Paleta de Colores y Tema */}
				<Paper className={classes.paper}>
					<div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 10 }}>
						<PaletteIcon style={{ color: "#B58863" }} />
						<div>
							<Typography variant="h6" style={{ color: "#D3C3B9", fontWeight: 700 }}>
								Paleta de Colores y Tema (WhatsApp Desktop)
							</Typography>
							<Typography variant="body2" style={{ color: "#A79E9C" }}>
								Selecciona tu combinación preferida para el modo oscuro o personaliza el color de acento.
							</Typography>
						</div>
					</div>

					<Grid container spacing={2}>
						{Object.values(presets).map((preset) => {
							const isActive = presetKey === preset.id;
							return (
								<Grid item xs={12} sm={6} key={preset.id}>
									<div
										className={`${classes.paletteCard} ${isActive ? classes.paletteCardActive : ""}`}
										style={{ backgroundColor: preset.paper, border: `1px solid ${preset.border}` }}
										onClick={() => {
											changePreset(preset.id);
											toast.success(`Paleta "${preset.name}" activada`);
										}}
									>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
											<Typography variant="subtitle2" style={{ color: preset.textPrimary, fontWeight: 600 }}>
												{preset.name}
											</Typography>
											{isActive && <CheckCircleIcon style={{ color: preset.primary, fontSize: 20 }} />}
										</div>

										<div className={classes.swatchRow}>
											<span
												className={classes.swatchCircle}
												style={{ backgroundColor: preset.background }}
												title={`Fondo: ${preset.background}`}
											/>
											<span
												className={classes.swatchCircle}
												style={{ backgroundColor: preset.paper }}
												title={`Panel: ${preset.paper}`}
											/>
											<span
												className={classes.swatchCircle}
												style={{ backgroundColor: preset.border }}
												title={`Borde: ${preset.border}`}
											/>
											<span
												className={classes.swatchCircle}
												style={{ backgroundColor: preset.textPrimary }}
												title={`Texto: ${preset.textPrimary}`}
											/>
											<span
												className={classes.swatchCircle}
												style={{ backgroundColor: preset.primary }}
												title={`Acento: ${preset.primary}`}
											/>
										</div>
									</div>
								</Grid>
							);
						})}
					</Grid>

					{/* Custom Accent Input */}
					<div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid rgba(61, 77, 85, 0.35)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
						<TextField
							label="Acento personalizado (HEX)"
							placeholder="#B58863"
							variant="outlined"
							size="small"
							value={accentInput}
							onChange={(e) => setAccentInput(e.target.value)}
							style={{ width: 220 }}
						/>
						{accentInput && (
							<span
								style={{
									width: 32,
									height: 32,
									borderRadius: 6,
									backgroundColor: accentInput,
									border: "1px solid #fff",
									display: "inline-block",
								}}
							/>
						)}
						<Button
							variant="contained"
							style={{ backgroundColor: "#B58863", color: "#161616", textTransform: "none", fontWeight: 600 }}
							onClick={handleApplyCustomAccent}
						>
							Guardar Acento
						</Button>
						{customAccent && (
							<Button
								variant="outlined"
								color="secondary"
								style={{ textTransform: "none" }}
								onClick={handleResetAccent}
							>
								Restablecer
							</Button>
						)}
					</div>
				</Paper>

				{/* Opciones Generales */}
				<Paper className={classes.paper}>
					<Typography variant="h6" style={{ color: "#D3C3B9", marginBottom: 12, fontWeight: 700 }}>
						Ajustes de Sistema
					</Typography>
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
						<Typography variant="body1" style={{ color: "#D3C3B9" }}>
							{i18n.t("settings.settings.userCreation.name")}
						</Typography>
						<Select
							margin="dense"
							variant="outlined"
							native
							id="userCreation-setting"
							name="userCreation"
							value={settings && settings.length > 0 ? getSettingValue("userCreation") : ""}
							className={classes.settingOption}
							onChange={handleChangeSetting}
						>
							<option value="enabled">
								{i18n.t("settings.settings.userCreation.options.enabled")}
							</option>
							<option value="disabled">
								{i18n.t("settings.settings.userCreation.options.disabled")}
							</option>
						</Select>
					</div>

					<TextField
						id="api-token-setting"
						InputProps={{ readOnly: true }}
						label="Token Api"
						margin="dense"
						variant="outlined"
						fullWidth
						value={settings && settings.length > 0 ? getSettingValue("userApiToken") : ""}
					/>
				</Paper>
			</Container>
		</div>
	);
};

export default Settings;
