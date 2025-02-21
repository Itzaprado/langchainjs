import PostgresEngine from './engine.js'; 
import { Document } from "@langchain/core/documents"; 
import { BaseDocumentLoader } from '@langchain/core/document_loaders/base';
import { textFormatter, csvFormatter, yamlFormatter, jsonFormatter } from './utils/utils.js';

// Options for PostgresLoader
export interface PostgresLoaderOptions {
  tableName?: string;
  schemaName?: string;
  contentColumns?: string[];
  metadataColumns?: string[];
  format?: "text" | "json" | "yaml" | "csv";
  formatter?: (row: { [key: string]: any }, contentColumns: string[]) => string;
  query?: string;
  metadataJsonColumn?: string;
}

export class PostgresLoader extends BaseDocumentLoader {

    private engine: PostgresEngine;
    private options: PostgresLoaderOptions;
  
    constructor(engine: PostgresEngine, options: PostgresLoaderOptions) {
      super();
      this.engine = engine;
      this.options = options;
    }

    static async create(engine: PostgresEngine, options: PostgresLoaderOptions): Promise<PostgresLoader> {

      let { schemaName, tableName, contentColumns, metadataColumns, format, query, formatter, metadataJsonColumn } = options;

      if (tableName && query) {
        throw new Error("Only one of 'table_name' or 'query' should be specified.");
      }
      if (!tableName && !query) {
        throw new Error("At least one of the parameters 'table_name' or 'query' needs to be provided");
      }
      if (format && formatter) {
        throw new Error("Only one of 'format' or 'formatter' should be specified.");
      }

      if (format && !["csv", "text", "json", "yaml"].includes(format)) {
        throw new Error("format must be type: 'csv', 'text', 'json', 'yaml'");
      }

      if (options.formatter !== undefined) {
        // use provided formatter
      } else if (format === "csv") {
        formatter = csvFormatter;
      } else if (format === "yaml") {
        formatter = yamlFormatter;
      } else if (format === "json") {
        formatter = jsonFormatter;
      } else {
        formatter = textFormatter;
      }

      if (!query) {
        query = `SELECT * FROM "${schemaName}"."${tableName}"`;
      }

      return new PostgresLoader(engine, options);
    }

    async load(): Promise<Document[]> {
      throw new Error('Method not implemented.');
    }
  }