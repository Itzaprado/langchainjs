import { test } from "@jest/globals";
import PostgresVectorStore, { PostgresVectorStoreArgs, dbConfigArgs } from "../vectorStore.js";
import PostgresEngine, { Column, PostgresEngineArgs, VectorStoreTableArgs } from "../engine.js";
import { Document, DocumentInterface } from "@langchain/core/documents";
import { SyntheticEmbeddings } from "@langchain/core/utils/testing";
import { v4 as uuidv4 } from "uuid";
import * as dotenv from "dotenv";
import { MaxMarginalRelevanceSearchOptions } from "@langchain/core/vectorstores";
import { DEFAULT_INDEX_NAME_SUFFIX, DistanceStrategy, HNSWIndex, IVFFlatIndex } from "../indexes.js";

dotenv.config()

const CUSTOM_TABLE = "test_table_custom";
const VECTOR_SIZE = 768;
const ID_COLUMN = "uuid";
const CONTENT_COLUMN = "my_content";
const EMBEDDING_COLUMN = "my_embedding";
const METADATA_COLUMNS = [new Column("page", "TEXT"), new Column("source", "TEXT")];
const STORE_METADATA = true;
const DEFAULT_INDEX_NAME = CUSTOM_TABLE + DEFAULT_INDEX_NAME_SUFFIX;

const embeddingService = new SyntheticEmbeddings({ vectorSize: VECTOR_SIZE });
const texts = ["foo", "bar", "baz"];
const metadatas: Record<string, any>[] = [];
const docs: DocumentInterface[] = [];
const embeddings = [];

let vectorStoreInstance: PostgresVectorStore;

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
  metadatas.push({ "page": i.toString(), "source": "google.com" });
  docs.push(new Document({ pageContent: texts[i], metadata: metadatas[i] }));
  embeddings.push(embeddingService.embedQuery(texts[i]));
}

describe("VectorStore creation", () => {
  let PEInstance: PostgresEngine;

  beforeAll(async () => {
    PEInstance = await PostgresEngine.fromInstance(
      process.env.PROJECT_ID ?? "",
      process.env.REGION ?? "",
      process.env.INSTANCE_NAME ?? "",
      process.env.DB_NAME ?? "",
      pgArgs
    );

    await PEInstance.pool.raw(`DROP TABLE IF EXISTS ${CUSTOM_TABLE}`)
    await PEInstance.initVectorstoreTable(CUSTOM_TABLE, VECTOR_SIZE, vsTableArgs);
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

  test('should create a new VectorStoreInstance using fromTexts method', async () => {
    const config: dbConfigArgs = {
      engine: PEInstance,
      tableName: CUSTOM_TABLE,
      dbConfig: pvectorArgs
    }

    const vectorStoreInstance = await PostgresVectorStore.fromTexts(texts, metadatas, embeddingService, config)
    expect(vectorStoreInstance).toBeDefined();

    const { rows } = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(rows).toHaveLength(3);
  });

  test('should create a new VectorStoreInstance using fromDocuments method', async () => {
    await PEInstance.pool.raw(`TRUNCATE TABLE "${CUSTOM_TABLE}"`);

    const config: dbConfigArgs = {
      engine: PEInstance,
      tableName: CUSTOM_TABLE,
      dbConfig: pvectorArgs
    }

    const vectorStoreInstance = await PostgresVectorStore.fromDocuments(docs, embeddingService, config)
    expect(vectorStoreInstance).toBeDefined();

    const { rows } = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(rows).toHaveLength(3);
  });

  afterAll(async () => {
    await PEInstance.pool.raw(`DROP TABLE "${CUSTOM_TABLE}"`)

    try {
      await PEInstance.closeConnection();
    } catch (error) {
      throw new Error(`Error on closing connection: ${error}`);
    }
  })
})

describe("VectorStore methods", () => {

  let PEInstance: PostgresEngine;

  beforeAll(async () => {
    PEInstance = await PostgresEngine.fromInstance(
      process.env.PROJECT_ID ?? "",
      process.env.REGION ?? "",
      process.env.INSTANCE_NAME ?? "",
      process.env.DB_NAME ?? "",
      pgArgs
    );

    await PEInstance.pool.raw(`DROP TABLE IF EXISTS "${CUSTOM_TABLE}"`)
    await PEInstance.initVectorstoreTable(CUSTOM_TABLE, VECTOR_SIZE, vsTableArgs);
    vectorStoreInstance = await PostgresVectorStore.create(PEInstance, embeddingService, CUSTOM_TABLE, pvectorArgs)
  });

  test("addVectors: should throw an error if vectors length is different from documents length", async () => {
    let _texts = [docs[0].pageContent, docs[1].pageContent];
    const vectors = await embeddingService.embedDocuments(_texts);

    async function addVectorsFn() {
      await vectorStoreInstance.addVectors(vectors, docs);
    }

    expect(addVectorsFn).rejects.toThrow("The number of vectors must match the number of documents provided.");
  });

  test("addVectors: should throw an error if ids length is different from documents length", async () => {
    const vectors = await embeddingService.embedDocuments(texts);
    const ids = [uuidv4(), uuidv4()];

    async function addVectorsFn() {
      await vectorStoreInstance.addVectors(vectors, docs, { ids });
    }

    expect(addVectorsFn).rejects.toThrow("The number of ids must match the number of documents provided.");
  })

  test("addDocuments: should return the same length of results as the added documents {3}", async () => {
    const ids = Array.from(texts).map(() => uuidv4());
    await vectorStoreInstance.addDocuments(docs, { ids });
    const { rows } = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(rows).toHaveLength(3);
    await PEInstance.pool.raw(`TRUNCATE TABLE "${CUSTOM_TABLE}"`);
  })

  test("addDocuments: should return the same length of results as the added documents {3}, without passing ids", async () => {
    await vectorStoreInstance.addDocuments(docs);
    const { rows } = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(rows).toHaveLength(3);
  })

  test("similaritySearch", async () => {
    const results = await vectorStoreInstance.similaritySearch("foo", 1);
    expect(results.length).toBe(1)

    const results_2 = await vectorStoreInstance.similaritySearch("foo", 1,  `"page" = '2'`)
    const expected = [
      new Document({ pageContent: "bar" })
    ];
    results_2.forEach((row: any, index: number) => {
      expect(row).toMatchObject(expected[index])
    });
  })

  test("similaritySearchWithScore", async () => {
    const results = await vectorStoreInstance.similaritySearchWithScore("foo");
    const expected = new Document({ pageContent: "foo" })

    expect(results.length).toBe(3)
    expect(results[0][0]).toMatchObject(expected)
  })

  test("similaritySearchVectorWithScore", async () => {
    const embedding = await embeddingService.embedQuery("foo")
    const results = await vectorStoreInstance.similaritySearchVectorWithScore(embedding, 1);
    const expected = new Document({ pageContent: "foo" })
    
    expect(results[0][0]).toMatchObject(expected)
    expect(results[0][1]).toBe(0)
  })

  test("delete method with an ID", async () => {
    await PEInstance.pool.raw(`TRUNCATE TABLE "${CUSTOM_TABLE}"`);
    const ids = Array.from(texts).map(() => uuidv4());
    await vectorStoreInstance.addDocuments(docs, { ids });
    const { rows } = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(rows).toHaveLength(3);

    await vectorStoreInstance.delete({ids: [ids[0]]});
    const results = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(results.rows).toHaveLength(2);
  })

  test("delete method with no ids", async () => {
    await PEInstance.pool.raw(`TRUNCATE TABLE "${CUSTOM_TABLE}"`);
    const ids = Array.from(texts).map(() => uuidv4());
    await vectorStoreInstance.addDocuments(docs, { ids });
    const { rows } = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(rows).toHaveLength(3);

    await vectorStoreInstance.delete({});
    const results = await PEInstance.pool.raw(`SELECT * FROM "${CUSTOM_TABLE}"`);
    expect(results.rows).toHaveLength(3);
  })

  test("maxMarginalRelevanceSearch", async () => {
    const results = await vectorStoreInstance.maxMarginalRelevanceSearch("bar", { k: 4});
    const expected = new Document({ pageContent: "bar" })
    
    expect(results[0]).toMatchObject(expected)    
  })

  test("maxMarginalRelevanceSearch with filter", async () => {
    const options = {
      k: 1,
      filter: `"my_content" = 'foo'` 
    }
    const results = await vectorStoreInstance.maxMarginalRelevanceSearch("foo", options)
    const expected = new Document({ pageContent: "foo" })
    
    expect(results[0]).toMatchObject(expected)
    
  })

  test("maxMarginalRelevanceSearchWithScoreByVector with lambda and fetchK", async () => {
    const options: MaxMarginalRelevanceSearchOptions<'PostgresVectorStore["FilterType"]'> = {
      k: 4,
      fetchK: 10,
      lambda: 0.75
    }

    const results = await vectorStoreInstance.maxMarginalRelevanceSearch("bar", options)
    const expected = new Document({ pageContent: "bar" })
    
    expect(results[0]).toMatchObject(expected)
  })

  test("applyVectorIndex - HNSWIndex", async () => {
    const index = new HNSWIndex();
    await vectorStoreInstance.applyVectorIndex(index);
    const isValidIndex = await vectorStoreInstance.isValidIndex(DEFAULT_INDEX_NAME);

    expect(isValidIndex).toBe(true);
    await PEInstance.pool.raw(`DROP INDEX IF EXISTS ${DEFAULT_INDEX_NAME}`);
  });

  test("applyVectorIndex - IVFFlatIndex", async () => {
    let index = new IVFFlatIndex({distanceStrategy: DistanceStrategy.EUCLIDEAN});
    await vectorStoreInstance.applyVectorIndex(index);
    let isValidIVFFlatIndex = await vectorStoreInstance.isValidIndex(DEFAULT_INDEX_NAME);
    expect(isValidIVFFlatIndex).toBe(true);

    index = new IVFFlatIndex({name: "secondindex", distanceStrategy: DistanceStrategy.EUCLIDEAN});
    await vectorStoreInstance.applyVectorIndex(index);
    isValidIVFFlatIndex = await vectorStoreInstance.isValidIndex("secondindex");
    expect(isValidIVFFlatIndex).toBe(true);
    await PEInstance.pool.raw(`DROP INDEX IF EXISTS ${DEFAULT_INDEX_NAME}`);
    await PEInstance.pool.raw(`DROP INDEX IF EXISTS secondindex`);
  });

  afterAll(async () => {
    try {
      await PEInstance.pool.raw(`TRUNCATE TABLE "${CUSTOM_TABLE}"`);
      await PEInstance.closeConnection();
    } catch (error) {
      throw new Error(`Error on closing connection: ${error}`);
    }
  });
})
