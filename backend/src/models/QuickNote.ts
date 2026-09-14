import {
  Table,
  Column,
  DataType,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement
} from "sequelize-typescript";

@Table
class QuickNote extends Model<QuickNote> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column(DataType.STRING)
  title: string;

  @Column(DataType.STRING)
  category: string;

  @Column(DataType.TEXT)
  content: string;

  @Column(DataType.TEXT)
  mediaUrl: string;

  @Column(DataType.STRING)
  mediaType: string;

  @Column(DataType.INTEGER)
  userId: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default QuickNote;
