class StrategyMixin {
  operator: string;
  searchFunction: string;
  indexFunction: string;

  constructor(operator: string, searchFunction: string, indexFunction: string) {
    this.operator = operator;
    this.searchFunction = searchFunction;
    this.indexFunction = indexFunction;
  }
}

/**
 * Enumerator of the Distance strategies.
 */
export class DistanceStrategy extends StrategyMixin {
  public static EUCLIDEAN =  new StrategyMixin("<->", "l2_distance", "vector_l2_ops");
  public static COSINE_DISTANCE = new StrategyMixin("<=>", "cosine_distance", "vector_cosine_ops");
  public static INNER_PRODUCT = new StrategyMixin("<#>", "inner_product", "vector_ip_ops"); 
}

export const DEFAULT_DISTANCE_STRATEGY = DistanceStrategy.COSINE_DISTANCE;
export const DEFAULT_INDEX_NAME_SUFFIX: string = "langchainvectorindex";

export abstract class BaseIndex {
  name: string;
  indexType: string;
  distanceStrategy: DistanceStrategy;
  partialIndexes: string[]

  constructor(name?: string, indexType: string = "base", distanceStrategy: DistanceStrategy = DistanceStrategy.COSINE_DISTANCE, partialIndexes?: string[]) {
    this.name = name!;
    this.indexType = indexType;
    this.distanceStrategy = distanceStrategy;
    this.partialIndexes = partialIndexes!;
  }

  /**
   * Set index query options for vector store initialization.
   */
  abstract indexOptions(): string;
}

export class ExactNearestNeighbor extends BaseIndex {
  indexType: string = "exactnearestneighbor";

  constructor() {
    super()  
  }

  indexOptions(): string {
    throw new Error("indexOptions method must be implemented by subclass");
  }
}

export class HNSWIndex extends BaseIndex {
  indexType: string = "hnsw";
  m: number = 16;
  efConstruction: number = 64;

  constructor() {
    super();
  }

  indexOptions(): string {
    return `(m = ${this.m}, ef_construction = ${this.efConstruction})`
  }
}

export class IVFFlatIndex extends BaseIndex {
  indexType: string = "ivfflat";
  lists: number = 100;

  constructor() {
    super()
  }

  indexOptions(): string {
    return `(lists = ${this.lists})`
  }
}

/**
 * Convert index attributes to string.
 * Must be implemented by subclasses.
 */
export abstract class QueryOptions {
  abstract to_string(): string;
}

export class HNSWQueryOptions extends QueryOptions {
  efSearch: number = 40;

  constructor() {
    super();
  }

  to_string(): string {
    return `hnsw.ef_search = ${this.efSearch}`;
  }
}

export class IVFFlatQueryOptions extends QueryOptions {
  probes: number = 1;

  constructor() {
    super();
  }

  to_string(): string {
    return `ivflfat.probes = ${this.probes}`;
  }
}
