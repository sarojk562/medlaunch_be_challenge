import { Priority } from './enums';

export interface Comment {
  id: string;
  text: string;
  author: string;
  createdAt: Date;
}

export interface Entry {
  id: string;
  title: string;
  content: string;
  priority: Priority;
  author: string;
  comments: Comment[];
  createdAt: Date;
  updatedAt: Date;
}
