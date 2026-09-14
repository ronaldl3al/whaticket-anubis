import React, { useEffect, useState } from "react";
import QRCode from "qrcode.react";
import openSocket from "../../services/socket-io";
import toastError from "../../errors/toastError";

import { Dialog, DialogContent, Paper, Typography } from "@material-ui/core";
import { i18n } from "../../translate/i18n";
import api from "../../services/api";

const QrcodeModal = ({ open, onClose, whatsAppId }) => {
	const [qrCode, setQrCode] = useState("");

	useEffect(() => {
		const fetchSession = async () => {
			if (!whatsAppId) return;

			try {
				const { data } = await api.get(`/whatsapp/${whatsAppId}`);
				setQrCode(data.qrcode);
			} catch (err) {
				toastError(err);
			}
		};
		fetchSession();
	}, [whatsAppId]);

	useEffect(() => {
		if (!whatsAppId) return;
		const socket = openSocket();

		const handleUpdate = session => {
			if (session && (+session.id === +whatsAppId || session.id === whatsAppId)) {
				if (session.qrcode) {
					setQrCode(session.qrcode);
				}

				if (session.status === "CONNECTED") {
					onClose();
				}
			}
		};

		socket.on("whatsappSession", data => {
			if (data.action === "update" && data.session) {
				handleUpdate(data.session);
			}
		});

		socket.on("whatsapp", data => {
			if (data.action === "update" && data.whatsapp) {
				handleUpdate(data.whatsapp);
			}
		});

		return () => {
			socket.disconnect();
		};
	}, [whatsAppId, onClose]);

	return (
		<Dialog open={open} onClose={onClose} maxWidth="lg" scroll="paper">
			<DialogContent>
				<Paper elevation={0}>
					<Typography color="primary" gutterBottom>
						{i18n.t("qrCode.message")}
					</Typography>
					{qrCode ? (
						qrCode.startsWith("data:image") || qrCode.startsWith("iVBORw0KGgo") ? (
							<img
								src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
								alt="QR Code"
								style={{ width: 256, height: 256, display: "block", margin: "0 auto" }}
							/>
						) : (
							<QRCode value={qrCode} size={256} />
						)
					) : (
						<span>Waiting for QR Code</span>
					)}
				</Paper>
			</DialogContent>
		</Dialog>
	);
};

export default React.memo(QrcodeModal);
