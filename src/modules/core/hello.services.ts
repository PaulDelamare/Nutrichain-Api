/**
 * Service hello.
 */
export const helloService = {
  exempleService: async <T extends object>(validatedData: T): Promise<T> => {
    return validatedData;
  },
};
