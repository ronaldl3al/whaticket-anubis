import { Sequelize } from "sequelize-typescript";
import User from "../models/User";
import Setting from "../models/Setting";
import Contact from "../models/Contact";
import Ticket from "../models/Ticket";
import Whatsapp from "../models/Whatsapp";
import ContactCustomField from "../models/ContactCustomField";
import Message from "../models/Message";
import Queue from "../models/Queue";
import WhatsappQueue from "../models/WhatsappQueue";
import UserQueue from "../models/UserQueue";
import QuickAnswer from "../models/QuickAnswer";
import QuickNote from "../models/QuickNote";
import WppKey from "../models/WppKey";

// eslint-disable-next-line
const dbConfig = require("../config/database");
const env = process.env.NODE_ENV || "development";
const sequelize = new Sequelize(dbConfig[env] || dbConfig);

const models = [
  User,
  Contact,
  Ticket,
  Message,
  Whatsapp,
  ContactCustomField,
  Setting,
  Queue,
  WhatsappQueue,
  UserQueue,
  QuickAnswer,
  QuickNote,
  WppKey
];

sequelize.addModels(models);

export default sequelize;
