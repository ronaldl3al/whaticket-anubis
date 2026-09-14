import React, { useState, useEffect } from "react";
import openSocket from "../../services/socket-io";
import { toast } from "react-toastify";

import {
  makeStyles,
  Container,
  Paper,
  Typography,
  TextField,
  InputAdornment,
  Button,
  Grid,
  Card,
  CardHeader,
  CardContent,
  CardActions,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@material-ui/core";
import {
  Search as SearchIcon,
  Add as AddIcon,
  FileCopyOutlined as CopyIcon,
  Edit as EditIcon,
  DeleteOutline as DeleteIcon,
  Image as ImageIcon,
  Videocam as VideoIcon,
} from "@material-ui/icons";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import QuickNoteModal from "../../components/QuickNoteModal";

const useStyles = makeStyles((theme) => ({
  container: {
    paddingTop: theme.spacing(4),
    paddingBottom: theme.spacing(6),
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing(3),
    flexWrap: "wrap",
    gap: theme.spacing(2),
  },
  filterBar: {
    display: "flex",
    gap: theme.spacing(1),
    marginBottom: theme.spacing(3),
    flexWrap: "wrap",
  },
  chip: {
    cursor: "pointer",
    backgroundColor: "#1a2e36",
    color: "#A79E9C",
    "&.active": {
      backgroundColor: "#B58863",
      color: "#161616",
      fontWeight: 600,
    },
  },
  card: {
    backgroundColor: "#161616",
    border: "1px solid rgba(61, 77, 85, 0.4)",
    borderRadius: 10,
    display: "flex",
    flexDirection: "column",
    height: "100%",
    transition: "transform 0.2s, box-shadow 0.2s",
    "&:hover": {
      transform: "translateY(-2px)",
      boxShadow: "0 6px 16px rgba(0, 0, 0, 0.4)",
      borderColor: "#B58863",
    },
  },
  cardTitle: {
    color: "#D3C3B9",
    fontWeight: 600,
    fontSize: "1.05rem",
  },
  cardCategory: {
    color: "#B58863",
    fontSize: "0.78rem",
    fontWeight: 500,
    marginTop: 2,
  },
  cardMedia: {
    width: "100%",
    maxHeight: 180,
    objectFit: "cover",
    cursor: "pointer",
    borderBottom: "1px solid rgba(61, 77, 85, 0.3)",
  },
  cardContent: {
    flexGrow: 1,
    color: "#A79E9C",
    fontSize: "0.9rem",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    padding: theme.spacing(2),
  },
  cardActions: {
    borderTop: "1px solid rgba(61, 77, 85, 0.3)",
    justifyContent: "space-between",
    padding: theme.spacing(1, 2),
  },
}));

const CATEGORIES = [
  "Todas",
  "Catálogo y Productos",
  "Precios y Promociones",
  "Envíos y Entregas",
  "Garantías y Políticas",
  "Guiones de Venta",
];

const QuickNotes = () => {
  const classes = useStyles();

  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchParam, setSearchParam] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Todas");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingNote, setDeletingNote] = useState(null);
  const [previewMediaUrl, setPreviewMediaUrl] = useState(null);
  const [previewMediaType, setPreviewMediaType] = useState(null);

  const fetchNotes = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/quickNotes", {
        params: {
          searchParam,
          category: selectedCategory === "Todas" ? undefined : selectedCategory,
        },
      });
      setNotes(data.quickNotes || []);
    } catch (err) {
      toastError(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      fetchNotes();
    }, 400);
    return () => clearTimeout(delayDebounce);
  }, [searchParam, selectedCategory]);

  useEffect(() => {
    const socket = openSocket();

    socket.on("quickNote", (data) => {
      if (data.action === "create") {
        setNotes((prev) => [data.quickNote, ...prev]);
      }
      if (data.action === "update") {
        setNotes((prev) =>
          prev.map((n) => (n.id === data.quickNote.id ? data.quickNote : n))
        );
      }
      if (data.action === "delete") {
        setNotes((prev) => prev.filter((n) => n.id !== Number(data.quickNoteId)));
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleCopyText = (content) => {
    navigator.clipboard.writeText(content);
    toast.success("¡Texto copiado al portapapeles!");
  };

  const handleOpenCreate = () => {
    setEditingNoteId(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (note) => {
    setEditingNoteId(note.id);
    setModalOpen(true);
  };

  const handleConfirmDelete = (note) => {
    setDeletingNote(note);
    setDeleteConfirmOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingNote) return;
    try {
      await api.delete(`/quickNotes/${deletingNote.id}`);
      toast.success("Nota eliminada correctamente");
      setDeleteConfirmOpen(false);
      setDeletingNote(null);
    } catch (err) {
      toastError(err);
    }
  };

  return (
    <Container className={classes.container} maxWidth="lg">
      <div className={classes.header}>
        <div>
          <Typography variant="h5" style={{ color: "#D3C3B9", fontWeight: 700 }}>
            Notas Rápidas y Material de Apoyo
          </Typography>
          <Typography variant="body2" style={{ color: "#A79E9C" }}>
            Fichas técnicas, fotos de productos, catálogos, guiones y políticas para asesorar a tus clientes rápidamente.
          </Typography>
        </div>

        <Button
          variant="contained"
          style={{ backgroundColor: "#B58863", color: "#161616", fontWeight: 600, textTransform: "none" }}
          startIcon={<AddIcon />}
          onClick={handleOpenCreate}
        >
          Nueva Nota
        </Button>
      </div>

      {/* Search and Category Filter */}
      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        <TextField
          placeholder="Buscar por título, contenido o palabra clave..."
          variant="outlined"
          size="small"
          value={searchParam}
          onChange={(e) => setSearchParam(e.target.value)}
          style={{ flexGrow: 1, minWidth: 260 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon style={{ color: "#A79E9C" }} />
              </InputAdornment>
            ),
          }}
        />
      </div>

      <div className={classes.filterBar}>
        {CATEGORIES.map((cat) => (
          <Chip
            key={cat}
            label={cat}
            className={`${classes.chip} ${selectedCategory === cat ? "active" : ""}`}
            onClick={() => setSelectedCategory(cat)}
          />
        ))}
      </div>

      {/* Grid of Notes */}
      {loading ? (
        <Typography style={{ color: "#A79E9C", textAlign: "center", marginTop: 40 }}>
          Cargando notas de apoyo...
        </Typography>
      ) : notes.length === 0 ? (
        <Paper style={{ padding: 40, textAlign: "center", backgroundColor: "#161616" }}>
          <Typography style={{ color: "#D3C3B9", fontSize: "1.1rem" }}>
            No hay notas rápidas registradas en esta categoría.
          </Typography>
          <Typography variant="body2" style={{ color: "#A79E9C", marginTop: 8 }}>
            Crea tu primera nota de apoyo con textos, fotos o videos para tu equipo.
          </Typography>
          <Button
            variant="outlined"
            style={{ marginTop: 16, borderColor: "#B58863", color: "#B58863" }}
            onClick={handleOpenCreate}
          >
            Crear Nota Ahora
          </Button>
        </Paper>
      ) : (
        <Grid container spacing={3}>
          {notes.map((note) => (
            <Grid item xs={12} sm={6} md={4} key={note.id}>
              <Card className={classes.card}>
                {note.mediaUrl && (
                  note.mediaType === "video" ? (
                    <video
                      src={note.mediaUrl}
                      controls
                      className={classes.cardMedia}
                    />
                  ) : (
                    <img
                      src={note.mediaUrl}
                      alt={note.title}
                      className={classes.cardMedia}
                      onClick={() => {
                        setPreviewMediaUrl(note.mediaUrl);
                        setPreviewMediaType("image");
                      }}
                    />
                  )
                )}

                <CardHeader
                  title={<Typography className={classes.cardTitle}>{note.title}</Typography>}
                  subheader={<Typography className={classes.cardCategory}>{note.category || "General"}</Typography>}
                  style={{ paddingBottom: 0 }}
                />

                <CardContent className={classes.cardContent}>
                  {note.content}
                </CardContent>

                <CardActions className={classes.cardActions}>
                  <Button
                    size="small"
                    startIcon={<CopyIcon />}
                    style={{ color: "#B58863", textTransform: "none", fontSize: "0.82rem" }}
                    onClick={() => handleCopyText(note.content)}
                  >
                    Copiar Texto
                  </Button>

                  <div>
                    <IconButton size="small" style={{ color: "#A79E9C" }} onClick={() => handleOpenEdit(note)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" style={{ color: "rgba(255, 100, 100, 0.8)" }} onClick={() => handleConfirmDelete(note)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </div>
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Note Modal */}
      <QuickNoteModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        noteId={editingNoteId}
        onSave={() => fetchNotes()}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>¿Eliminar Nota Rápida?</DialogTitle>
        <DialogContent>
          <Typography>
            ¿Estás seguro de que deseas eliminar la nota <strong>"{deletingNote?.title}"</strong>? Esta acción no se puede deshacer.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)} color="secondary">
            Cancelar
          </Button>
          <Button onClick={handleDelete} style={{ color: "red" }}>
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>

      {/* Media Fullscreen Preview Dialog */}
      <Dialog
        open={Boolean(previewMediaUrl)}
        onClose={() => setPreviewMediaUrl(null)}
        maxWidth="md"
      >
        <DialogContent style={{ padding: 8, backgroundColor: "#000", textAlign: "center" }}>
          {previewMediaType === "video" ? (
            <video src={previewMediaUrl} controls style={{ maxWidth: "100%", maxHeight: "80vh" }} />
          ) : (
            <img src={previewMediaUrl} alt="zoom" style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} />
          )}
        </DialogContent>
      </Dialog>
    </Container>
  );
};

export default QuickNotes;
