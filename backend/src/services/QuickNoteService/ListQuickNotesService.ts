import { Sequelize, Op } from "sequelize";
import QuickNote from "../../models/QuickNote";

interface Request {
  searchParam?: string;
  category?: string;
}

interface Response {
  quickNotes: QuickNote[];
  count: number;
}

const ListQuickNotesService = async ({
  searchParam = "",
  category
}: Request): Promise<Response> => {
  const sanitized = searchParam.toLowerCase().trim();
  const whereConditions: any = {};

  if (sanitized) {
    whereConditions[Op.or] = [
      Sequelize.where(
        Sequelize.fn("LOWER", Sequelize.col("title")),
        "LIKE",
        `%${sanitized}%`
      ),
      Sequelize.where(
        Sequelize.fn("LOWER", Sequelize.col("content")),
        "LIKE",
        `%${sanitized}%`
      ),
      Sequelize.where(
        Sequelize.fn("LOWER", Sequelize.col("category")),
        "LIKE",
        `%${sanitized}%`
      )
    ];
  }

  if (category && category !== "all" && category !== "Todas") {
    whereConditions.category = category;
  }

  const { count, rows: quickNotes } = await QuickNote.findAndCountAll({
    where: whereConditions,
    order: [["updatedAt", "DESC"]]
  });

  return {
    quickNotes,
    count
  };
};

export default ListQuickNotesService;
