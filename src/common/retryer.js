// @ts-check

import { CustomError } from "./error.js";
import { logger } from "./log.js";

// Script variables.

// Count the number of GitHub API tokens available.
const PATs = Object.keys(process.env).filter((key) =>
  /PAT_\d*$/.exec(key),
).length;
const RETRIES = process.env.NODE_ENV === "test" ? 7 : PATs;

/**
 * @typedef {import("axios").AxiosResponse} AxiosResponse Axios response.
 * @typedef {(variables: any, token: string, retriesForTests?: number) => Promise<AxiosResponse>} FetcherFunction Fetcher function.
 */

/**
 * Try to execute the fetcher function until it succeeds or the max number of retries is reached.
 *
 * @param {FetcherFunction} fetcher The fetcher function.
 * @param {any} variables Object with arguments to pass to the fetcher function.
 * @param {number} retries How many times to retry.
 * @returns {Promise<any>} The response from the fetcher function.
 */
const isRetryableStatus = (status) =>
  status === 403 || status === 429 || status >= 500;

const retryer = async (fetcher, variables, retries = 0) => {
  if (!RETRIES) {
    throw new CustomError("No GitHub API tokens found", CustomError.NO_TOKENS);
  }

  if (retries > RETRIES) {
    throw new CustomError(
      "GitHub API temporarily unavailable",
      CustomError.MAX_RETRY,
    );
  }

  try {
    const response = await fetcher(
      variables,
      // @ts-ignore
      process.env[`PAT_${retries + 1}`],
      retries,
    );

    const errors = response?.data?.errors;
    const errorType = errors?.[0]?.type;
    const errorMsg = errors?.[0]?.message || "";
    const isRateLimited =
      errorType === "RATE_LIMITED" || /rate limit/i.test(errorMsg);
    const isRetryable =
      isRateLimited || isRetryableStatus(response?.status || 0);

    if (isRetryable) {
      logger.log(`PAT_${retries + 1} Failed`);
      return retryer(fetcher, variables, retries + 1);
    }

    return response;
  } catch (err) {
    /** @type {any} */
    const e = err;
    if (!e?.response) {
      throw e;
    }

    const status = e.response.status || 0;
    const message = e.response.data?.message;
    const isInvalidToken =
      message === "Bad credentials" ||
      message === "Sorry. Your account was suspended.";

    if (isInvalidToken || isRetryableStatus(status)) {
      logger.log(`PAT_${retries + 1} Failed`);
      return retryer(fetcher, variables, retries + 1);
    }

    return e.response;
  }
};

export { retryer, RETRIES };
export default retryer;
