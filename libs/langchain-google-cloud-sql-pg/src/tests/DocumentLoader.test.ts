import { test } from "@jest/globals";
import  { PostgresLoader, PostgresLoaderOptions } from "../DocumentLoader.js";
import PostgresEngine, { PostgresEngineArgs } from "../engine.js";
import { Document, DocumentInterface } from "@langchain/core/documents";

import * as dotenv from "dotenv";

dotenv.config()

const SCHEMA_NAME = "public";
const CUSTOM_TABLE = "test_table_custom";
const ID_COLUMN = "uuid";
const CONTENT_COLUMN = ["my_content"];
const METADATA_COLUMNS = ["page", "source"];
const FORMATTER = (row: { [key: string]: any }, content_columns: string[]): string => {
  return content_columns
    .filter((column) => column in row)
    .map((column) => String(row[column]))
    .join(" ");
};


const metadatas = [];
const docs: DocumentInterface[] = [];

const pgArgs: PostgresEngineArgs = {
  user: process.env.DB_USER ?? "",
  password: process.env.PASSWORD ?? ""
}

const documentLoaderArgs: PostgresLoaderOptions = {
  tableName: CUSTOM_TABLE,
  schemaName: SCHEMA_NAME,
  contentColumns: CONTENT_COLUMN,
  metadataColumns: METADATA_COLUMNS,
  format: "text",
  query: "",
  formatter: FORMATTER,
};


describe("Document loader creation", () => {
  let PEInstance: PostgresEngine;
  let postgresLoaderInstance: PostgresLoader;

  beforeAll(async () => {
    PEInstance = await PostgresEngine.from_instance(
      process.env.PROJECT_ID ?? "",
      process.env.REGION ?? "",
      process.env.INSTANCE_NAME ?? "",
      process.env.DB_NAME ?? "",
      pgArgs
    );
  });

  test('should throw an error if no table name or query is provided', async () => {
    const documentLoaderArgs:  PostgresLoaderOptions= {
      schemaName: undefined,
      query: undefined,
    }

    async function createInstance() {
      postgresLoaderInstance = await PostgresLoader.create(PEInstance, documentLoaderArgs)
    }

    expect(createInstance()).rejects.toThrowError("At least one of the parameters 'table_name' or 'query' needs to be provided");
  });


  test('should throw an error if an invalid format is provided', async () => {
      const documentLoaderArgs: PostgresLoaderOptions = {
        tableName: CUSTOM_TABLE,
        format: 'invalid_format',
      };

      async function createInstance() {
        postgresLoaderInstance = await PostgresLoader.create(PEInstance, documentLoaderArgs);
      }

      await expect(createInstance()).rejects.toThrowError("format must be type: 'csv', 'text', 'json', 'yaml'");
    });

   test('should throw an error if both format and formatter are provided', async () => {
      const documentLoaderArgs: PostgresLoaderOptions = {
        tableName: CUSTOM_TABLE,
        format: "text",
        formatter: FORMATTER,
      };

      async function createInstance() {
        postgresLoaderInstance = await PostgresLoader.create(PEInstance, documentLoaderArgs);
      }

      await expect(createInstance()).rejects.toThrowError("Only one of 'format' or 'formatter' should be specified.");
    });

    test('should throw an error if both table name and query are provided', async () => {
      const documentLoaderArgs: PostgresLoaderOptions = {
        tableName: CUSTOM_TABLE,
        schemaName: SCHEMA_NAME,
        query: "SELECT * FROM some_table",
      };

      async function createInstance() {
        postgresLoaderInstance = await PostgresLoader.create(PEInstance, documentLoaderArgs);
      }

      await expect(createInstance()).rejects.toThrowError("Only one of 'table_name' or 'query' should be specified.");
    });
    
  test('should create a new document Loader instance', async () => {
    const documentLoaderArgs:  PostgresLoaderOptions= {
      tableName: CUSTOM_TABLE,
      schemaName: "public",
      contentColumns: ["my_content"],
      metadataColumns: ["page", "source"],
      format: "text",
      query: "",
      formatter: undefined,
    }

    const vectorStoreInstance = await PostgresLoader.create(PEInstance, documentLoaderArgs)

    expect(vectorStoreInstance).toBeDefined();
  });

  afterAll(async () => {

    try {
      await PEInstance.closeConnection();
    } catch (error) {
      throw new Error(`Error on closing connection: ${error}`);
    }
  })
  
})


