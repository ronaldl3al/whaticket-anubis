import React, { useState, useEffect, useReducer, useContext, useRef } from "react";
import openSocket from "../../services/socket-io";
import { toast } from "react-toastify";
import { useHistory } from "react-router-dom";

import { makeStyles } from "@material-ui/core/styles";
import Table from "@material-ui/core/Table";
import TableBody from "@material-ui/core/TableBody";
import TableCell from "@material-ui/core/TableCell";
import TableHead from "@material-ui/core/TableHead";
import TableRow from "@material-ui/core/TableRow";
import Paper from "@material-ui/core/Paper";
import Button from "@material-ui/core/Button";
import Avatar from "@material-ui/core/Avatar";
import WhatsAppIcon from "@material-ui/icons/WhatsApp";
import SearchIcon from "@material-ui/icons/Search";
import TextField from "@material-ui/core/TextField";
import InputAdornment from "@material-ui/core/InputAdornment";

import IconButton from "@material-ui/core/IconButton";
import DeleteOutlineIcon from "@material-ui/icons/DeleteOutline";
import EditIcon from "@material-ui/icons/Edit";

import api from "../../services/api";
import TableRowSkeleton from "../../components/TableRowSkeleton";
import ContactModal from "../../components/ContactModal";
import ConfirmationModal from "../../components/ConfirmationModal/";

import { i18n } from "../../translate/i18n";
import MainHeader from "../../components/MainHeader";
import Title from "../../components/Title";
import MainHeaderButtonsWrapper from "../../components/MainHeaderButtonsWrapper";
import MainContainer from "../../components/MainContainer";
import toastError from "../../errors/toastError";
import { AuthContext } from "../../context/Auth/AuthContext";
import { Can } from "../../components/Can";

const reducer = (state, action) => {
  if (action.type === "LOAD_CONTACTS") {
    const contacts = action.payload;
    const newContacts = [];

    contacts.forEach((contact) => {
      const contactIndex = state.findIndex((c) => c.id === contact.id);
      if (contactIndex !== -1) {
        state[contactIndex] = contact;
      } else {
        newContacts.push(contact);
      }
    });

    return [...state, ...newContacts];
  }

  if (action.type === "UPDATE_CONTACTS") {
    const contact = action.payload;
    const contactIndex = state.findIndex((c) => c.id === contact.id);

    if (contactIndex !== -1) {
      state[contactIndex] = contact;
      return [...state];
    } else {
      return [contact, ...state];
    }
  }

  if (action.type === "DELETE_CONTACT") {
    const contactId = action.payload;

    const contactIndex = state.findIndex((c) => c.id === contactId);
    if (contactIndex !== -1) {
      state.splice(contactIndex, 1);
    }
    return [...state];
  }

  if (action.type === "RESET") {
    return [];
  }
};

const useStyles = makeStyles((theme) => ({
  mainPaper: {
    flex: 1,
    padding: theme.spacing(1),
    overflowY: "scroll",
    ...theme.scrollbarStyles,
  },
}));

const Contacts = () => {
  const classes = useStyles();
  const history = useHistory();

  const { user } = useContext(AuthContext);

  const [loading, setLoading] = useState(false);
  const [pageNumber, setPageNumber] = useState(1);
  const [searchParam, setSearchParam] = useState("");
  const [contacts, dispatch] = useReducer(reducer, []);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [deletingContact, setDeletingContact] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
  const [confirmMergeOpen, setConfirmMergeOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    dispatch({ type: "RESET" });
    setPageNumber(1);
  }, [searchParam]);

  useEffect(() => {
    setLoading(true);
    const delayDebounceFn = setTimeout(() => {
      const fetchContacts = async () => {
        try {
          const { data } = await api.get("/contacts/", {
            params: { searchParam, pageNumber },
          });
          dispatch({ type: "LOAD_CONTACTS", payload: data.contacts });
          setHasMore(data.hasMore);
          setLoading(false);
        } catch (err) {
          toastError(err);
        }
      };
      fetchContacts();
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [searchParam, pageNumber]);

  useEffect(() => {
    const socket = openSocket();

    socket.on("contact", (data) => {
      if (data.action === "update" || data.action === "create") {
        dispatch({ type: "UPDATE_CONTACTS", payload: data.contact });
      }

      if (data.action === "delete") {
        dispatch({ type: "DELETE_CONTACT", payload: +data.contactId });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const handleSearch = (event) => {
    setSearchParam(event.target.value.toLowerCase());
  };

  const handleOpenContactModal = () => {
    setSelectedContactId(null);
    setContactModalOpen(true);
  };

  const handleCloseContactModal = () => {
    setSelectedContactId(null);
    setContactModalOpen(false);
  };

  const handleSaveTicket = async (contactId) => {
    if (!contactId) return;
    setLoading(true);
    try {
      const { data: ticket } = await api.post("/tickets", {
        contactId: contactId,
        userId: user?.id,
        status: "open",
      });
      history.push(`/tickets/${ticket.id}`);
    } catch (err) {
      toastError(err);
    }
    setLoading(false);
  };

  const hadleEditContact = (contactId) => {
    setSelectedContactId(contactId);
    setContactModalOpen(true);
  };

  const handleDeleteContact = async (contactId) => {
    try {
      await api.delete(`/contacts/${contactId}`);
      toast.success(i18n.t("contacts.toasts.deleted"));
    } catch (err) {
      toastError(err);
    }
    setDeletingContact(null);
    setSearchParam("");
    setPageNumber(1);
  };


  const fileUploadRef = useRef(null);

  const handleExportGoogleCsv = async (type = "unregistered") => {
    try {
      const { data } = await api.get(`/contacts/export-google?type=${type}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `google_contactos_${type}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("Archivo CSV generado exitosamente");
    } catch (err) {
      toastError(err);
    }
  };

  const handleImportGoogleCsv = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      setLoading(true);
      const { data } = await api.post("/contacts/import-google", formData);
      toast.success(
        `Contactos importados: ${data.total} (${data.createdCount} nuevos, ${data.updatedCount} actualizados)`
      );
      dispatch({ type: "RESET" });
      setPageNumber(1);
      setLoading(false);
    } catch (err) {
      toastError(err);
      setLoading(false);
    }
    if (fileUploadRef.current) {
      fileUploadRef.current.value = "";
    }
  };

  const handleSyncWhatsappContacts = async () => {
    try {
      setLoading(true);
      const { data } = await api.post("/contacts/import");
      toast.success(
        `Contactos de WhatsApp sincronizados (${data.updatedCount || 0} actualizados, ${data.createdCount || 0} nuevos)`
      );
      dispatch({ type: "RESET" });
      setPageNumber(1);
      setLoading(false);
    } catch (err) {
      toastError(err);
      setLoading(false);
    }
  };

  const handleMergeDuplicates = async () => {
    try {
      setLoading(true);
      const { data } = await api.post("/contacts/merge-duplicates");
      toast.success(
        `Fusión completada: ${data.duplicatesMerged || 0} contactos duplicados fusionados y ${data.lidsResolved || 0} identificadores LID convertidos a celulares`
      );
      dispatch({ type: "RESET" });
      setPageNumber(1);
      setLoading(false);
    } catch (err) {
      toastError(err);
      setLoading(false);
    }
  };

  const handleDeleteAllContacts = async () => {
    try {
      setLoading(true);
      const { data } = await api.post("/contacts/delete-all");
      toast.success(`Se eliminaron ${data.count || 0} contactos`);
      dispatch({ type: "RESET" });
      setPageNumber(1);
      setLoading(false);
    } catch (err) {
      toastError(err);
      setLoading(false);
    }
  };

  const loadMore = () => {
    setPageNumber((prevState) => prevState + 1);
  };

  const handleScroll = (e) => {
    if (!hasMore || loading) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - (scrollTop + 100) < clientHeight) {
      loadMore();
    }
  };

  return (
    <MainContainer className={classes.mainContainer}>
      <ContactModal
        open={contactModalOpen}
        onClose={handleCloseContactModal}
        aria-labelledby="form-dialog-title"
        contactId={selectedContactId}
      ></ContactModal>
      <ConfirmationModal
        title={
          deletingContact
            ? `${i18n.t("contacts.confirmationModal.deleteTitle")} ${
                deletingContact.name
              }?`
            : ""
        }
        open={confirmOpen}
        onClose={setConfirmOpen}
        onConfirm={() =>
          deletingContact && handleDeleteContact(deletingContact.id)
        }
      >
        {`${i18n.t("contacts.confirmationModal.deleteMessage")}`}
      </ConfirmationModal>
      <ConfirmationModal
        title="¿Eliminar TODOS los contactos?"
        open={confirmDeleteAllOpen}
        onClose={setConfirmDeleteAllOpen}
        onConfirm={handleDeleteAllContacts}
      >
        ¿Estás completamente seguro de que deseas eliminar TODOS los contactos de Whaticket? Esta acción vaciará la lista para que puedas importar tu archivo limpio desde cero.
      </ConfirmationModal>
      <ConfirmationModal
        title="Fusionar Contactos Duplicados"
        open={confirmMergeOpen}
        onClose={setConfirmMergeOpen}
        onConfirm={handleMergeDuplicates}
      >
        ¿Desea buscar y fusionar contactos duplicados? Se unificarán números con formatos locales (0424... / 424...) e internacionales (58424...), así como identificadores LID de WhatsApp con sus números celulares reales. Se reasignarán todos los tickets y mensajes sin perder ninguna información.
      </ConfirmationModal>
      <MainHeader>
        <Title>{i18n.t("contacts.title")}</Title>
        <MainHeaderButtonsWrapper>
          <TextField
            placeholder={i18n.t("contacts.searchPlaceholder")}
            type="search"
            value={searchParam}
            onChange={handleSearch}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon style={{ color: "gray" }} />
                </InputAdornment>
              ),
            }}
          />
          <input
            type="file"
            ref={fileUploadRef}
            style={{ display: "none" }}
            accept=".csv"
            onChange={handleImportGoogleCsv}
          />
          <Button
            variant="contained"
            color="primary"
            onClick={() => fileUploadRef.current?.click()}
          >
            Importar Google CSV
          </Button>
          <Button
            variant="contained"
            style={{ backgroundColor: "#128C7E", color: "#fff" }}
            onClick={handleSyncWhatsappContacts}
            startIcon={<WhatsAppIcon />}
          >
            Sincronizar WhatsApp
          </Button>
          <Button
            variant="contained"
            style={{ backgroundColor: "#f57c00", color: "#fff" }}
            onClick={() => setConfirmMergeOpen(true)}
          >
            Fusionar Duplicados
          </Button>
          <Button
            variant="contained"
            style={{ backgroundColor: "#25D366", color: "#fff" }}
            onClick={() => handleExportGoogleCsv("unregistered")}
          >
            Exportar No Registrados
          </Button>
          <Button
            variant="contained"
            color="default"
            onClick={() => handleExportGoogleCsv("all")}
          >
            Exportar Todos
          </Button>
          <Button
            variant="outlined"
            style={{ color: "#d32f2f", borderColor: "#d32f2f" }}
            onClick={() => setConfirmDeleteAllOpen(true)}
          >
            Borrar Todos
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleOpenContactModal}
          >
            {i18n.t("contacts.buttons.add")}
          </Button>
        </MainHeaderButtonsWrapper>
      </MainHeader>
      <Paper
        className={classes.mainPaper}
        variant="outlined"
        onScroll={handleScroll}
      >
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>{i18n.t("contacts.table.name")}</TableCell>
              <TableCell align="center">
                {i18n.t("contacts.table.whatsapp")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("contacts.table.email")}
              </TableCell>
              <TableCell align="center">
                {i18n.t("contacts.table.actions")}
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <>
              {contacts.map((contact) => (
                <TableRow key={contact.id}>
                  <TableCell style={{ paddingRight: 0 }}>
                    {<Avatar src={contact.profilePicUrl} />}
                  </TableCell>
                  <TableCell>{contact.name}</TableCell>
                  <TableCell align="center">{contact.number}</TableCell>
                  <TableCell align="center">{contact.email}</TableCell>
                  <TableCell align="center">
                    <IconButton
                      size="small"
                      onClick={() => handleSaveTicket(contact.id)}
                    >
                      <WhatsAppIcon />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => hadleEditContact(contact.id)}
                    >
                      <EditIcon />
                    </IconButton>
                    <Can
                      role={user.profile}
                      perform="contacts-page:deleteContact"
                      yes={() => (
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            setConfirmOpen(true);
                            setDeletingContact(contact);
                          }}
                        >
                          <DeleteOutlineIcon />
                        </IconButton>
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {loading && <TableRowSkeleton avatar columns={3} />}
            </>
          </TableBody>
        </Table>
      </Paper>
    </MainContainer>
  );
};

export default Contacts;
