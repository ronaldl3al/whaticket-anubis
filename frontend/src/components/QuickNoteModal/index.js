import React, { useState, useEffect, useRef } from "react";
import * as Yup from "yup";
import { Formik, Form, Field } from "formik";
import { toast } from "react-toastify";

import {
  makeStyles,
  Button,
  TextField,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  CircularProgress,
  MenuItem,
  Typography,
} from "@material-ui/core";
import api from "../../services/api";
import toastError from "../../errors/toastError";

const useStyles = makeStyles((theme) => ({
  root: {
    flexWrap: "wrap",
  },
  textField: {
    marginBottom: theme.spacing(2),
    width: "100%",
  },
  btnWrapper: {
    position: "relative",
  },
  buttonProgress: {
    color: "#B58863",
    position: "absolute",
    top: "50%",
    left: "50%",
    marginTop: -12,
    marginLeft: -12,
  },
  mediaPreview: {
    marginTop: 12,
    padding: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 8,
    border: "1px dashed #3D4D55",
    textAlign: "center",
  },
  previewImg: {
    maxWidth: "100%",
    maxHeight: 220,
    borderRadius: 6,
    objectFit: "contain",
  },
  previewVideo: {
    maxWidth: "100%",
    maxHeight: 220,
    borderRadius: 6,
  },
}));

const NoteSchema = Yup.object().shape({
  title: Yup.string().required("El título es requerido"),
  content: Yup.string().required("El contenido es requerido"),
  category: Yup.string().nullable(),
});

const CATEGORIES = [
  "General",
  "Catálogo y Productos",
  "Precios y Promociones",
  "Envíos y Entregas",
  "Garantías y Políticas",
  "Guiones de Venta",
];

const QuickNoteModal = ({ open, onClose, noteId, onSave }) => {
  const classes = useStyles();
  const isMounted = useRef(true);

  const initialState = {
    title: "",
    category: "General",
    content: "",
    mediaUrl: "",
    mediaType: "",
  };

  const [note, setNote] = useState(initialState);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setNote(initialState);
      return;
    }

    if (noteId) {
      const fetchNote = async () => {
        try {
          const { data } = await api.get(`/quickNotes/${noteId}`);
          if (isMounted.current) {
            setNote(data);
          }
        } catch (err) {
          toastError(err);
        }
      };
      fetchNote();
    } else {
      setNote(initialState);
    }
  }, [noteId, open]);

  const handleMediaUpload = async (e, setFieldValue) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    setUploadingMedia(true);
    const formData = new FormData();
    formData.append("media", file);

    try {
      const { data } = await api.post("/quickNotes/media-upload", formData);
      setFieldValue("mediaUrl", data.mediaUrl);
      setFieldValue("mediaType", data.mediaType);
      toast.success("Foto o video cargado exitosamente");
    } catch (err) {
      toastError(err);
    }
    setUploadingMedia(false);
  };

  const handleSaveNote = async (values) => {
    try {
      if (noteId) {
        await api.put(`/quickNotes/${noteId}`, values);
        toast.success("Nota actualizada con éxito");
      } else {
        const { data } = await api.post("/quickNotes", values);
        if (onSave) onSave(data);
        toast.success("Nota creada con éxito");
      }
      onClose();
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <div className={classes.root}>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
        <DialogTitle id="note-dialog-title">
          {noteId ? "Editar Nota Rápida" : "Nueva Nota Rápida (Material de Apoyo)"}
        </DialogTitle>
        <Formik
          initialValues={note}
          enableReinitialize={true}
          validationSchema={NoteSchema}
          onSubmit={(values, actions) => {
            handleSaveNote(values);
            actions.setSubmitting(false);
          }}
        >
          {({ values, errors, touched, isSubmitting, setFieldValue }) => (
            <Form>
              <DialogContent dividers>
                <Field
                  as={TextField}
                  label="Título de la Nota"
                  name="title"
                  placeholder="ej: Ficha técnica Anubis Pro, Precios Mayo 2026..."
                  autoFocus
                  error={touched.title && Boolean(errors.title)}
                  helperText={touched.title && errors.title}
                  variant="outlined"
                  margin="dense"
                  className={classes.textField}
                />

                <Field
                  as={TextField}
                  select
                  label="Categoría"
                  name="category"
                  variant="outlined"
                  margin="dense"
                  className={classes.textField}
                >
                  {CATEGORIES.map((cat) => (
                    <MenuItem key={cat} value={cat}>
                      {cat}
                    </MenuItem>
                  ))}
                </Field>

                <Field
                  as={TextField}
                  label="Contenido / Texto Explicativo"
                  name="content"
                  placeholder="Escribe la información detallada, respuestas frecuentes, especificaciones..."
                  error={touched.content && Boolean(errors.content)}
                  helperText={touched.content && errors.content}
                  variant="outlined"
                  margin="dense"
                  multiline
                  rows={6}
                  className={classes.textField}
                />

                {/* Multimedia Attachment */}
                <div style={{ marginTop: 8 }}>
                  <Typography variant="caption" style={{ color: "#A79E9C", display: "block", marginBottom: 6 }}>
                    Foto o Video de Apoyo (Catálogo, demostración o ficha):
                  </Typography>
                  <input
                    type="file"
                    id="note-media-file"
                    style={{ display: "none" }}
                    accept="image/*,video/*"
                    onChange={(e) => handleMediaUpload(e, setFieldValue)}
                  />
                  <label htmlFor="note-media-file">
                    <Button
                      variant="outlined"
                      component="span"
                      color="primary"
                      disabled={uploadingMedia || isSubmitting}
                      style={{ textTransform: "none" }}
                    >
                      {uploadingMedia ? "Subiendo archivo..." : "📷 / 🎥 Adjuntar Foto o Video"}
                    </Button>
                  </label>

                  {values.mediaUrl && (
                    <div className={classes.mediaPreview}>
                      {values.mediaType === "video" ? (
                        <video src={values.mediaUrl} controls className={classes.previewVideo} />
                      ) : (
                        <img src={values.mediaUrl} alt="preview" className={classes.previewImg} />
                      )}
                      <div>
                        <Button
                          size="small"
                          color="secondary"
                          style={{ marginTop: 8 }}
                          onClick={() => {
                            setFieldValue("mediaUrl", "");
                            setFieldValue("mediaType", "");
                          }}
                        >
                          Eliminar archivo
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </DialogContent>
              <DialogActions>
                <Button onClick={onClose} color="secondary" disabled={isSubmitting || uploadingMedia} variant="outlined">
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  color="primary"
                  disabled={isSubmitting || uploadingMedia}
                  variant="contained"
                  className={classes.btnWrapper}
                >
                  {noteId ? "Guardar Cambios" : "Crear Nota"}
                  {isSubmitting && <CircularProgress size={24} className={classes.buttonProgress} />}
                </Button>
              </DialogActions>
            </Form>
          )}
        </Formik>
      </Dialog>
    </div>
  );
};

export default QuickNoteModal;
