/**
 * 手写信号量，用于控制并发数量
 *
 * 不引入外部依赖，适用于 MVP 场景
 */
export class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(maxConcurrent: number) {
    this.permits = maxConcurrent;
  }

  /**
   * 获取许可，返回释放函数
   */
  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }

    // 等待许可释放
    return new Promise<() => void>((resolve) => {
      this.waitQueue.push(() => {
        this.permits--;
        let released = false;
        resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      });
    });
  }

  private release(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  /**
   * 在信号量保护下执行函数
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

/**
 * 并发执行多个任务，受信号量限制
 * 返回结果按原始顺序排列
 */
export async function parallelWithLimit<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrent: number
): Promise<T[]> {
  const semaphore = new Semaphore(maxConcurrent);
  const results: T[] = new Array(tasks.length);

  await Promise.all(
    tasks.map(async (task, index) => {
      results[index] = await semaphore.run(task);
    })
  );

  return results;
}
