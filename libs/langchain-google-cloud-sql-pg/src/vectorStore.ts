import { Embeddings } from "@langchain/core/embeddings";
import { VectorStore } from "@langchain/core/vectorstores";
import { DocumentInterface } from "@langchain/core/documents";
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_DISTANCE_STRATEGY, DistanceStrategy, QueryOptions } from "./indexes.js";
import PostgresEngine from "./engine.js";
import { customZip } from "./utils/utils.js";

export interface PostgresVectorStoreArgs {
  schemaName?: string,
  contentColumn?: string,
  embeddingColumn?: string,
  metadataColumns?: Array<string>,
  idColumn?: string,
  distance_strategy?: DistanceStrategy,
  k?: Number,
  fetch_k?: Number,
  lambdaMult?: Number,
  ignoreMetadataColumns?: Array<string>,
  metadataJsonColumn?: string,
  indexQueryOptions?: QueryOptions
}

/**
 * Create a new PostgresVectorStore instance.
 * 
 * @param {PostgresEngine} engine Required - Connection pool engine for managing connections to Cloud SQL for PostgreSQL database.
 * @param {Embeddings} embedding_service Required - Text embedding model to use.
 * @param {string} table_name Required - Name of an existing table or table to be created.
 * @param {string} schema_name  Database schema name of the table. Defaults to "public".
 * @param {string} content_column Column that represent a Document's page_content. Defaults to "content".
 * @param {string} embedding_column Column for embedding vectors. The embedding is generated from the document value. Defaults to "embedding".
 * @param {Array<string} metadata_columns Column(s) that represent a document's metadata.
 * @param {Array<string} ignore_metadata_columns Optional - Column(s) to ignore in pre-existing tables for a document's metadata. Can not be used with metadata_columns.
 * @param {string} id_column Column that represents the Document's id. Defaults to "langchain_id".
 * @param {string} metadata_json_column Optional - Column to store metadata as JSON. Defaults to "langchain_metadata".
 * @param {DistanceStrategy} distance_strategy Distance strategy to use for vector similarity search. Defaults to COSINE_DISTANCE.
 * @param {Number} k Number of Documents to return from search. Defaults to 4.
 * @param {Number} fetch_k Number of Documents to fetch to pass to MMR algorithm.
 * @param {Number} lambda_mult Number between 0 and 1 that determines the degree of diversity among the results with 0 corresponding to maximum diversity and 1 to minimum diversity. Defaults to 0.5.
 * @param {QueryOptions} index_query_options Optional - Index query option.
 * 
 * @returns PostgresVectorStore instance.
 */

class PostgresVectorStore extends VectorStore{
  private static _createKey = Symbol();
  engine: PostgresEngine;
  embeddings: Embeddings;
  tableName: string;
  schemaName: string;
  contentColumn: string;
  embeddingColumn: string;
  metadataColumns: Array<string>;
  ignoreMetadataColumns: Array<string>;
  idColumn: string;
  metadataJsonColumn: string;
  distance_strategy: DistanceStrategy;
  k: Number;
  fetch_k: Number;
  lambdaMult: Number;
  indexQueryOptions: QueryOptions;

  constructor(
    key: Symbol, 
    engine: PostgresEngine,
    embeddings: Embeddings,
    tableName: string,
    schemaName: string,
    contentColumn: string,
    embeddingColumn: string,
    metadataColumns: Array<string>,
    ignoreMetadataColumns: Array<string>,
    idColumn: string,
    metadataJsonColumn: string,
    distance_strategy: DistanceStrategy,
    k: Number,
    fetch_k: Number,
    lambdaMult: Number,
    indexQueryOptions: QueryOptions) {
    
    super(embeddings, {}); // TODO: pass the dbConfig: - Configuration settings for the database or storage system.

    if(key !== PostgresVectorStore._createKey) {
      throw new Error("Only create class through 'create' method!")
    }
    this.engine = engine;
    this.embeddings = embeddings;
    this.tableName = tableName;
    this.schemaName = schemaName;
    this.contentColumn = contentColumn;
    this.embeddingColumn = embeddingColumn;
    this.metadataColumns = metadataColumns;
    this.ignoreMetadataColumns = ignoreMetadataColumns;
    this.idColumn = idColumn;
    this.metadataJsonColumn = metadataJsonColumn;
    this.distance_strategy = distance_strategy;
    this.k = k;
    this.fetch_k = fetch_k;
    this.lambdaMult = lambdaMult;
    this.indexQueryOptions = indexQueryOptions;
  }

  static async create(
    engine: PostgresEngine,
    embeddings: Embeddings,
    tableName: string,
    {
      schemaName = "public",
      contentColumn = "content",
      embeddingColumn = "embedding",
      metadataColumns = [],
      ignoreMetadataColumns,
      idColumn = "langchain_id",
      metadataJsonColumn = "langchain_metadata",
      distance_strategy = DEFAULT_DISTANCE_STRATEGY,
      k = 4,
      fetch_k = 20,
      lambdaMult = 0.5,
      indexQueryOptions
    }: PostgresVectorStoreArgs
  ): Promise<PostgresVectorStore> {

    if(metadataColumns !== undefined && ignoreMetadataColumns !== undefined) {
      throw "Can not use both metadata_columns and ignore_metadata_columns.";
    }

    const {rows} = await engine.pool.raw(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName}' AND table_schema = '${schemaName}'`);
    let columns: {[key: string]: any} = {};

    for (const index in rows) {
      const row = rows[index];
      columns[row["column_name"]] = row["data_type"]
    }

    if(!columns.hasOwnProperty(idColumn)){
      throw `Id column: ${idColumn}, does not exist.`;
    }

    if(!columns.hasOwnProperty(contentColumn)){
      throw `Content column: ${contentColumn}, does not exist.`;
    }

    const contentType = columns[contentColumn];

    if(contentType !== "text" && !contentType.includes("char")) {
      throw `Content column: ${contentColumn}, is type: ${contentType}. It must be a type of character string.`
    }

    if(!columns.hasOwnProperty(embeddingColumn)) {
      throw `Embedding column: ${embeddingColumn}, does not exist.`
    }
        
    if(columns[embeddingColumn] !== "USER-DEFINED") {
      throw `Embedding column: ${embeddingColumn} is not of type Vector.`
    }

    metadataJsonColumn = columns.hasOwnProperty(metadataJsonColumn) ? metadataJsonColumn : "";

    for (const column of metadataColumns) {
      if(!columns.hasOwnProperty(column)) {
        throw `Metadata column: ${column}, does not exist.`
      }
    }

    const allColumns = columns;
    if(ignoreMetadataColumns !== undefined && ignoreMetadataColumns.length > 0) {
      for (const column of ignoreMetadataColumns) {
        delete allColumns[column];
      }

      delete allColumns[idColumn];
      delete allColumns[contentColumn];
      delete allColumns[embeddingColumn];
      metadataColumns = Object.keys(allColumns);
    } 
    return new PostgresVectorStore(
        PostgresVectorStore._createKey,
        engine,
        embeddings,
        tableName,
        schemaName,
        contentColumn,
        embeddingColumn,
        metadataColumns,
        ignoreMetadataColumns!,
        idColumn,
        metadataJsonColumn,
        distance_strategy,
        k,
        fetch_k,
        lambdaMult,
        indexQueryOptions!
      )
  }

  async addEmbeddings(
    texts: Iterable<string>,
    embeddings: number[][], 
    metadatas?: Array<Record<string, any>> | null,
    ids?: { [x: string]: any; },
  ): Promise<{[x: string]: any;}> {

    if(!ids) {
      ids = Array.from(texts).map(() => uuidv4());
    }
    if(!metadatas) {
      metadatas = Array.from(texts).map(() => new Object());
    }

    const tuples = customZip(ids, texts, embeddings, metadatas)
    
    // Insert embeddings
    for (const [id, content, embedding, metadata] of tuples) {
      const metadataColNames = this.metadataColumns.length > 0 ? this.metadataColumns.join(",") : "";

      let stmt = `INSERT INTO "${this.schemaName}"."${this.tableName}"(${this.idColumn}, ${this.contentColumn}, ${this.embeddingColumn}, ${metadataColNames}`
      let values = {
        id: id,
        content: content,
        embedding: `[${embedding.toString()}]`
      }
      let valuesStmt = " VALUES (:id, :content, :embedding";

      // Add metadata
      let extra = metadata;
      for (const metadataColumn of this.metadataColumns) {
        if(metadata.hasOwnProperty(metadataColumn)){
          valuesStmt += `, :${metadataColumn}`
          values[metadataColumn as keyof typeof values] = metadata[metadataColumn] //
          delete extra[metadataColumn]
        } else {
          valuesStmt += " ,null"
        }
      }

      // Add JSON column and/or close statement
      stmt += this.metadataJsonColumn ? `, ${this.metadataJsonColumn})` : ")";
      if(this.metadataJsonColumn) {
        valuesStmt += ", :extra)";
        Object.assign(values, {"extra": JSON.stringify(extra)})
      } else {
        valuesStmt += ")" 
      }

      const query = stmt + valuesStmt;
      await this.engine.pool.raw(query, values)
    }

    return ids;
  }

  async addTexts(texts: Iterable<string>, metadatas?: Array<Record<string, any>> | null, ids?: { [x: string]: any; }): Promise<{[x: string]: any;}> {
    const documents = Array.from(texts)
    const embeddings = await this.embeddings.embedDocuments(documents);
    ids = await this.addEmbeddings(texts, embeddings, metadatas, ids);

    return ids;
  }

  _vectorstoreType(): string { // TODO: implement methods
    //throw new Error("Method not implemented.");
    return ""
  }
  
  addVectors(vectors: number[][], documents: DocumentInterface[], options?: { [x: string]: any; }): Promise<string[] | void> {
    throw new Error("Method not implemented.");
  }

  /**
   * Adds documents to the vector store, embedding them first through the
   * `embeddings` instance.
   *
   * @param documents - Array of documents to embed and add.
   * @param options - Optional configuration for embedding and storing documents.
   * @returns A promise resolving to an array of document IDs or void, based on implementation.
   * @abstract
   */
  
  async addDocuments(documents: DocumentInterface[], options?: { [x: string]: any; }): Promise<string[] | void> {
    let texts = [];
    let metadatas = [];
    
    for (const doc of documents) {
      texts.push(doc.pageContent)
      metadatas.push(doc.metadata)
    }
    
    const results = await this.addTexts(texts, metadatas, options) 
    const ids = Object.values(results).filter(
      (value): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string")
    );

    return ids.length > 0 ? ids.flat() : undefined;
  }

  similaritySearchVectorWithScore(query: number[], k: number, filter?: this["FilterType"] | undefined): Promise<[DocumentInterface, number][]> {
    throw new Error("Method not implemented.");
  }

  /**
   * Deletes documents from the vector store based on the specified parameters.
   *
   * @param _params - Flexible key-value pairs defining conditions for document deletion.
   * @returns A promise that resolves once the deletion is complete.
   */
   async delete(_params?: Record<string, any>): Promise<void> { // TODO: test this method
    if(_params === undefined) return;
    const idList = _params.map((id: any) => `'${id}'`).join(", ");
    const query = `DELETE FROM "${this.schemaName}"."${this.tableName}" WHERE ${this.idColumn} in (${idList})`;
    await this.engine.pool.raw(query);
  }
}

export default PostgresVectorStore;
