import { AuthTypes, Connector, IpAddressTypes} from "@google-cloud/cloud-sql-connector";
import { GoogleAuth } from "google-auth-library";
import knex from "knex";
import { getIAMPrincipalEmail } from "./utils/utils.js";

export interface PostgresEngineArgs {
  ipType?: IpAddressTypes,
  user?: string, 
  password?: string,
  iamAccountEmail?: string,
}

export interface VectorStoreTableArgs {
  schemaName?: string,
  contentColumn?: string,
  embeddingColumn?: string,
  metadataColumns?: Column[],
  metadataJsonColumn?: string, 
  idColumn?: string | Column,
  overwriteExisting?: boolean,
  storeMetadata?: boolean
}

export class Column {
  name: string;
  dataType: string;
  nullable: boolean;

  constructor(name: string, dataType: string, nullable: boolean = true) {
    this.name = name;
    this.dataType = dataType;
    this.nullable = nullable;

    this.postInitilization()
  }

  private postInitilization() {
    if(typeof this.name !== "string") {
      throw "Column name must be type string";
    }

    if(typeof this.dataType !== "string") {
      throw "Column data_type must be type string";
    }

  }
}

class PostgresEngine {

  private static _createKey = Symbol();
  pool: knex.Knex<any, any[]>;
  static connector: Connector;

  constructor(key: Symbol , pool: knex.Knex<any, any[]>) {
    if(key !== PostgresEngine._createKey) {
      throw new Error("Only create class through 'create' method!")
    }
    this.pool = pool;
  }

  /**
   * @param projectId Required - GCP Project ID
   * @param region Required - Postgres Instance Region
   * @param instance Required - Postgres Instance name
   * @param database Required - Database name
   * @param ipType Optional - IP address type. Defaults to IPAddressType.PUBLIC
   * @param user Optional - Postgres user name. Defaults to undefined
   * @param password Optional - Postgres user password. Defaults to undefined
   * @param iamAccountEmail Optional - IAM service account email. Defaults to undefined
   * @returns PostgresEngine instance
   */

  static async from_instance(
    projectId: string,
    region: string,
    instance: string,
    database: string,
    {
      ipType = IpAddressTypes.PUBLIC,
      user, 
      password,
      iamAccountEmail
    }: PostgresEngineArgs): Promise<PostgresEngine> {

    let dbUser: string;
    let enableIAMAuth: boolean;

    if((!user && password) || (user && !password)) { // XOR for strings
      throw "Only one of 'user' or 'password' were specified. Either " +
        "both should be specified to use basic user/password " +
        "authentication or neither for IAM DB authentication.";
    }

    // User and password are given so we use the basic auth
    if(user !== undefined && password !== undefined) {
      enableIAMAuth = false;
      dbUser = user!;
    } else {
      enableIAMAuth = true;
      if(iamAccountEmail !== undefined) {
        dbUser = iamAccountEmail
      } else {
        // Get application default credentials
        const auth = new GoogleAuth({
          scopes: "https://www.googleapis.com/auth/cloud-platform"
        });
        // dbUser should be the iam principal email by passing the credentials obtained
        dbUser = await getIAMPrincipalEmail(auth)
      }
    }

    PostgresEngine.connector = new Connector();
    const clientOpts = await PostgresEngine.connector.getOptions({
      instanceConnectionName: `${projectId}:${region}:${instance}`,
      ipType: ipType,
      authType: enableIAMAuth ? AuthTypes.IAM : AuthTypes.PASSWORD
    })

    const dbConfig: knex.Knex.Config<any> = {
      client: 'pg',
      connection: {
        ...clientOpts,
        ...(password ? { password: password } : {}),
        user: dbUser,
        database: database,
      },
    };

    const engine = knex(dbConfig)
    
    return new PostgresEngine(PostgresEngine._createKey, engine)
  }

  /**
   * Create a PostgresEngine instance from an Knex instance.
   * 
   * @param engine knex instance
   * @returns PostgresEngine instance from a knex instance
   */
  static async from_engine(engine: knex.Knex<any, any[]>) {
    return new PostgresEngine(PostgresEngine._createKey, engine)
  }

  /**
   * Create a PostgresEngine instance from arguments.
   * 
   * @param url URL use to connect to a database
   * @param poolConfig Optional - Configuration pool to use in the Knex configuration
   * @returns PostgresEngine instance
   */
  static async from_engine_args(url: string | knex.Knex.StaticConnectionConfig, poolConfig?: knex.Knex.PoolConfig) {

    const driver = 'postgresql+asyncpg';

    if((typeof url === "string") && !url.startsWith(driver)){
      throw "Driver must be type 'postgresql+asyncpg'"
    }

    const dbConfig: knex.Knex.Config<any> = {
      client: 'pg',
      connection: url,
      acquireConnectionTimeout: 1000000,
      pool:{
        ...poolConfig,
        acquireTimeoutMillis: 600000
      }
    };

    const engine = knex(dbConfig)

    return new PostgresEngine(PostgresEngine._createKey, engine)
  }

  /**
   * Create a table for saving of vectors to be used with PostgresVectorStore.
   * 
   * @param tableName Postgres database table name
   * @param vectorSize Vector size for the embedding model to be used.
   * @param schemaName The schema name to store Postgres database table. Default: "public".
   * @param contentColumn Name of the column to store document content. Default: "content".
   * @param embeddingColumn Name of the column to store vector embeddings. Default: "embedding".
   * @param metadataColumns Optional - A list of Columns to create for custom metadata. Default: [].
   * @param metadataJsonColumn Optional - The column to store extra metadata in JSON format. Default: "langchain_metadata". 
   * @param idColumn Optional - Column to store ids. Default: "langchain_id" column name with data type UUID. 
   * @param overwriteExisting Whether to drop existing table. Default: False.
   * @param storeMetadata Whether to store metadata in the table. Default: True.
   */
  async init_vectorstore_table(
    tableName: string,
    vectorSize: number,
    {
    schemaName  = "public",
    contentColumn  = "content",
    embeddingColumn = "embedding",
    metadataColumns = [],
    metadataJsonColumn = "langchain_metadata", 
    idColumn = "langchain_id",
    overwriteExisting = false,
    storeMetadata = true
  }: VectorStoreTableArgs): Promise<void> {

    await this.pool.raw("CREATE EXTENSION IF NOT EXISTS vector")

    if(overwriteExisting) {
      await this.pool.schema.withSchema(schemaName).dropTableIfExists(tableName);
    }

    const idDataType = typeof idColumn === "string" ? "UUID" : idColumn.dataType;
    const idColumnName = typeof idColumn === "string" ? idColumn : idColumn.name;

    let query = `CREATE TABLE ${schemaName}.${tableName}(
      ${idColumnName} ${idDataType} PRIMARY KEY,
      ${contentColumn} TEXT NOT NULL,
      ${embeddingColumn} vector(${vectorSize}) NOT NULL`

    for (const column of metadataColumns) {
      const nullable = !column.nullable ? "NOT NULL" : "";
      query += `,\n ${column.name} ${column.dataType} ${nullable}`;
    }

    if(storeMetadata) {
      query += `,\n${metadataJsonColumn} JSON`;
    }

    query += `\n);`

    await this.pool.raw(query)
  }

  /**
   * Create a Cloud SQL table to store chat history.
   * 
   * @param tableName Table name to store chat history
   * @param schemaName Schema name to store chat history table
   */

  async init_chat_history_table(tableName: string, schemaName: string = "public"): Promise<void> {
    await this.pool.raw(
      `CREATE TABLE IF NOT EXISTS ${schemaName}.${tableName}(
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      data JSONB NOT NULL,
      type TEXT NOT NULL);`
    )
  }

  /**
   *  Dispose of connection pool
   */
  async closeConnection(): Promise<void> {
    await this.pool.destroy()
    if(PostgresEngine.connector !== undefined) {
     PostgresEngine.connector.close();
    }
  }

  // Just to test the connection to the database
  testConnection () {
    const now = this.pool.raw('SELECT NOW() as currentTimestamp')
    return now;
  }
}

export default PostgresEngine;