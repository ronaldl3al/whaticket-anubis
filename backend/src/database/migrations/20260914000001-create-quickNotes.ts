import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    try {
      const tableNames: any = await queryInterface.showAllTables();
      if (!tableNames.includes("QuickNotes")) {
        await queryInterface.createTable("QuickNotes", {
          id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
            allowNull: false
          },
          title: {
            type: DataTypes.STRING,
            allowNull: false
          },
          category: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: "General"
          },
          content: {
            type: DataTypes.TEXT,
            allowNull: false
          },
          mediaUrl: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null
          },
          mediaType: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null
          },
          userId: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null
          },
          createdAt: {
            type: DataTypes.DATE,
            allowNull: false
          },
          updatedAt: {
            type: DataTypes.DATE,
            allowNull: false
          }
        });
      }
    } catch (e) {
      console.error("Migration error creating QuickNotes:", e);
    }
  },

  down: async (queryInterface: QueryInterface) => {
    try {
      await queryInterface.dropTable("QuickNotes");
    } catch (e) {}
  }
};
