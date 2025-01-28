import { test } from "@jest/globals";
import PostgresVectorStore, { PostgresVectorStoreArgs } from "../vectorStore.js";
import PostgresEngine, { Column, PostgresEngineArgs, VectorStoreTableArgs } from "../engine.js";
import { Document, DocumentInterface } from "@langchain/core/documents";
import { SyntheticEmbeddings } from "@langchain/core/utils/testing";
import { v4 as uuidv4 } from "uuid";
import * as dotenv from "dotenv";

dotenv.config()

const CUSTOM_TABLE = "test_table_custom";
const VECTOR_SIZE = 768;
const ID_COLUMN="uuid";
const CONTENT_COLUMN = "my_content";
const EMBEDDING_COLUMN = "my_embedding";
const METADATA_COLUMNS = [new Column("page", "TEXT"), new Column("source", "TEXT")];
const STORE_METADATA = true;

const embeddingService = new SyntheticEmbeddings({vectorSize: VECTOR_SIZE});
const texts = ["foo", "bar", "baz"];
const metadatas = [];
const docs: DocumentInterface[] = [];
const embeddings = [];

const pgArgs: PostgresEngineArgs = {
  user: process.env.DB_USER ?? "",
  password: process.env.PASSWORD ?? ""
}

const vsTableArgs: VectorStoreTableArgs = {
  contentColumn: CONTENT_COLUMN,
  embeddingColumn: EMBEDDING_COLUMN,
  idColumn: ID_COLUMN, 
  metadataColumns: METADATA_COLUMNS,
  storeMetadata: STORE_METADATA,
  overwriteExisting: true
};

const pvectorArgs: PostgresVectorStoreArgs = {
  idColumn: ID_COLUMN,
  contentColumn: CONTENT_COLUMN,
  embeddingColumn: EMBEDDING_COLUMN,
  metadataColumns: ["page", "source"],
  metadataJsonColumn: "mymeta",
}

for (let i = 0; i < texts.length; i++) {
  metadatas.push({"page": i.toString(), "source": "google.com"});
  docs.push(new Document({pageContent: texts[i], metadata: metadatas[i]}));
  embeddings.push(embeddingService.embedQuery(texts[i]));
}

describe("VectorStore creation", () => {
  let PEInstance: PostgresEngine;
  let vectorStoreInstance: PostgresVectorStore;

  beforeAll(async () => {
    PEInstance = await PostgresEngine.from_instance(
      process.env.PROJECT_ID ?? "",
      process.env.REGION ?? "",
      process.env.INSTANCE_NAME ?? "",
      process.env.DB_NAME ?? "",
      pgArgs
    );

    await PEInstance.pool.raw(`DROP TABLE IF EXISTS ${CUSTOM_TABLE}`)
    await PEInstance.init_vectorstore_table(CUSTOM_TABLE, VECTOR_SIZE, vsTableArgs);
  });
  
  test('should throw an error if metadataColumns and ignoreMetadataColumns are defined', async () => {
    const pvectorArgs: PostgresVectorStoreArgs = {
      metadataColumns: ["page", "source"],
      ignoreMetadataColumns: ["page", "source"]
    }

    async function createVectorStoreInstance() {
      vectorStoreInstance = await PostgresVectorStore.create(PEInstance, embeddingService, CUSTOM_TABLE, pvectorArgs)
    }

    await expect(createVectorStoreInstance).rejects.toBe("Can not use both metadata_columns and ignore_metadata_columns.");
  });

  test('should throw an error if idColumn does not exist', async () => {
    const pvectorArgs: PostgresVectorStoreArgs = {
      idColumn: "my_id_column",
      contentColumn: CONTENT_COLUMN,
      embeddingColumn: EMBEDDING_COLUMN,
      metadataColumns: ["page", "source"],
      metadataJsonColumn: "mymeta",
    }

    async function createVectorStoreInstance() {
      vectorStoreInstance = await PostgresVectorStore.create(PEInstance, embeddingService, CUSTOM_TABLE, pvectorArgs)
    }

    await expect(createVectorStoreInstance).rejects.toBe(`Id column: ${pvectorArgs.idColumn}, does not exist.`);
  });

  test('should throw an error if contentColumn does not exist', async () => {
    const pvectorArgs: PostgresVectorStoreArgs = {
      idColumn: ID_COLUMN,
      contentColumn: "content_column_test",
      embeddingColumn: EMBEDDING_COLUMN,
      metadataColumns: ["page", "source"],
      metadataJsonColumn: "mymeta",
    }

    async function createVectorStoreInstance() {
      vectorStoreInstance = await PostgresVectorStore.create(PEInstance, embeddingService, CUSTOM_TABLE, pvectorArgs)
    }

    await expect(createVectorStoreInstance).rejects.toBe(`Content column: ${pvectorArgs.contentColumn}, does not exist.`);
  });

  test('should throw an error if embeddingColumn does not exist', async () => {
    const pvectorArgs: PostgresVectorStoreArgs = {
      idColumn: ID_COLUMN,
      contentColumn: CONTENT_COLUMN,
      embeddingColumn: "embedding_column_test",
      metadataColumns: ["page", "source"],
      metadataJsonColumn: "mymeta",
    }

    async function createVectorStoreInstance() {
      vectorStoreInstance = await PostgresVectorStore.create(PEInstance, embeddingService, CUSTOM_TABLE, pvectorArgs)
    }

    await expect(createVectorStoreInstance).rejects.toBe(`Embedding column: ${pvectorArgs.embeddingColumn}, does not exist.`);
  });

  test('should create a new VectorStoreInstance', async () => {
    const pvectorArgs: PostgresVectorStoreArgs = {
      idColumn: ID_COLUMN,
      contentColumn: CONTENT_COLUMN,
      embeddingColumn: EMBEDDING_COLUMN,
      metadataColumns: ["page", "source"],
      metadataJsonColumn: "mymeta",
    }

    const vectorStoreInstance = await PostgresVectorStore.create(PEInstance, embeddingService, CUSTOM_TABLE, pvectorArgs)
    
    expect(vectorStoreInstance).toBeDefined();
  });

  // TODO: Add a test for the delete method

  afterAll(async () => {
    await PEInstance.pool.raw(`DROP TABLE "${CUSTOM_TABLE}"`)

    try {
      await PEInstance.closeConnection();
    } catch (error) {
      throw new Error(`Error on closing connection: ${error}`);
    }
  })
})

describe("VectorStore addDocuments method", () => {

  let PEInstance: PostgresEngine;
  let vectorStoreInstance: PostgresVectorStore;

  beforeAll(async () => {
    PEInstance = await PostgresEngine.from_instance(
      process.env.PROJECT_ID ?? "",
      process.env.REGION ?? "",
      process.env.INSTANCE_NAME ?? "",
      process.env.DB_NAME ?? "",
      pgArgs
    );

    await PEInstance.pool.raw(`DROP TABLE IF EXISTS "${CUSTOM_TABLE}"`)
    await PEInstance.init_vectorstore_table(CUSTOM_TABLE, VECTOR_SIZE, vsTableArgs);
    vectorStoreInstance = await PostgresVectorStore.create(PEInstance, embeddingService, CUSTOM_TABLE, pvectorArgs)
  });

  test("should return the same length of results as the added documents {3}", async () => {
    const ids = Array.from(texts).map(() => uuidv4());
    await vectorStoreInstance.addDocuments(docs, ids);
    const {rows} = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(rows).toHaveLength(3);
  })

  test("should return the same length of results as the added documents {3}, without passing ids", async () => {
    await vectorStoreInstance.addDocuments(docs);
    const {rows} = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(rows).toHaveLength(3);
  })

  afterEach(async () => {
    await PEInstance.pool.raw(`TRUNCATE TABLE "${CUSTOM_TABLE}"`);
  })

  afterAll(async () => {
    try {
      await PEInstance.closeConnection();
    } catch (error) {
      throw new Error(`Error on closing connection: ${error}`);
    }
  });
})
