import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    try {
      const tableInfo: any = await queryInterface.describeTable("QuickAnswers");
      if (!tableInfo.mediaUrl) {
        await queryInterface.addColumn("QuickAnswers", "mediaUrl", {
          type: DataTypes.TEXT,
          allowNull: true,
          defaultValue: null
        });
      }
      if (!tableInfo.mediaType) {
        await queryInterface.addColumn("QuickAnswers", "mediaType", {
          type: DataTypes.STRING,
          allowNull: true,
          defaultValue: null
        });
      }
    } catch (e) {
      console.error("Migration error adding media to QuickAnswers:", e);
    }
  },

  down: async (queryInterface: QueryInterface) => {
    try {
      await queryInterface.removeColumn("QuickAnswers", "mediaUrl");
      await queryInterface.removeColumn("QuickAnswers", "mediaType");
    } catch (e) {}
  }
};
