/**
 * This file defines helper methods
 */

const _ = require("lodash");
const config = require("config");
const constants = require("../app-constants");
const logger = require("./logger");
const httpStatus = require("http-status");
const Interceptor = require("express-interceptor");
const m2mAuth = require("tc-core-library-js").auth.m2m;
const request = require("superagent");
const querystring = require("querystring");

const localLogger = {
  debug: (message) =>
    logger.debug({
      component: "helper",
      context: message.context,
      message: message.message,
    }),
  error: (message) =>
    logger.error({
      component: "helper",
      context: message.context,
      message: message.message,
    }),
  info: (message) =>
    logger.info({
      component: "helper",
      context: message.context,
      message: message.message,
    }),
};

const m2m = m2mAuth(
  _.pick(config, [
    "AUTH0_URL",
    "AUTH0_AUDIENCE",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_SECRET",
    "AUTH0_PROXY_SERVER_URL",
  ])
);

/**
 * Gracefully handle errors thrown from the app
 * @param {Object} err the error object
 * @param {Object} req the request object
 * @param {Object} res the response object
 * @param {Function} next the next middleware
 */
function errorHandler(err, req, res, next) {
  logger.logFullError(err, {
    component: "app",
    signature: req.signature || `${req.method}_${req.url}`,
  });
  const errorResponse = {};
  const status = err.isJoi
    ? httpStatus.BAD_REQUEST
    : err.status || err.httpStatus || httpStatus.INTERNAL_SERVER_ERROR;

  if (_.isArray(err.details)) {
    if (err.isJoi) {
      _.map(err.details, (e) => {
        if (e.message) {
          if (_.isUndefined(errorResponse.message)) {
            errorResponse.message = e.message;
          } else {
            errorResponse.message += `, ${e.message}`;
          }
        }
      });
    }
  }
  if (err.response) {
    // extract error message from V3/V5 API
    errorResponse.message =
      _.get(err, "response.body.result.content.message") ||
      _.get(err, "response.body.message");
  }
  if (_.isUndefined(errorResponse.message)) {
    if (
      err.message &&
      (err.httpStatus || status !== httpStatus.INTERNAL_SERVER_ERROR)
    ) {
      errorResponse.message = err.message;
    } else {
      errorResponse.message = "Internal server error";
    }
  }
  res.status(status).json(errorResponse);
}

// intercepts the response body from jwtAuthenticator
const interceptor = Interceptor((req, res) => {
  return {
    isInterceptable: () => {
      return res.statusCode === 403;
    },

    intercept: (body, send) => {
      let obj;
      if (body.length > 0) {
        try {
          obj = JSON.parse(body);
        } catch (e) {
          logger.error("Invalid response body.");
        }
      }
      if (obj && _.get(obj, "result.content.message")) {
        const ret = { message: obj.result.content.message };
        res.statusCode = 401;
        send(JSON.stringify(ret));
      } else {
        send(body);
      }
    },
  };
});

/**
 * Check if exists.
 *
 * @param {Array} source the array in which to search for the term
 * @param {Array | String} term the term to search
 */
function checkIfExists(source, term) {
  let terms;

  if (!_.isArray(source)) {
    throw new Error("Source argument should be an array");
  }

  source = source.map((s) => s.toLowerCase());

  if (_.isString(term)) {
    terms = term.toLowerCase().split(" ");
  } else if (_.isArray(term)) {
    terms = term.map((t) => t.toLowerCase());
  } else {
    throw new Error("Term argument should be either a string or an array");
  }

  for (let i = 0; i < terms.length; i++) {
    if (source.includes(terms[i])) {
      return true;
    }
  }

  return false;
}

/**
 * Wrap async function to standard express function
 * @param {Function} fn the async function
 * @returns {Function} the wrapped function
 */
function wrapExpress(fn) {
  return function (req, res, next) {
    fn(req, res, next).catch(next);
  };
}

/**
 * Wrap all functions from object
 * @param obj the object (controller exports)
 * @returns {Object|Array} the wrapped object
 */
function autoWrapExpress(obj) {
  if (_.isArray(obj)) {
    return obj.map(autoWrapExpress);
  }
  if (_.isFunction(obj)) {
    if (obj.constructor.name === "AsyncFunction") {
      return wrapExpress(obj);
    }
    return obj;
  }
  _.each(obj, (value, key) => {
    obj[key] = autoWrapExpress(value);
  });
  return obj;
}

/**
 * Function to get M2M token
 * @returns {Promise}
 */
const getM2MToken = async () => {
  return await m2m.getMachineToken(
    config.AUTH0_CLIENT_ID,
    config.AUTH0_CLIENT_SECRET
  );
};

/**
 * Get link for a given page.
 * @param {Object} req the HTTP request
 * @param {Number} page the page number
 * @returns {String} link for the page
 */
function getPageLink(req, page) {
  const q = _.assignIn({}, req.query, { page });
  return `${req.protocol}://${req.get("Host")}${req.baseUrl}${
    req.path
  }?${querystring.stringify(q)}`;
}

/**
 * Set HTTP response headers from result.
 * @param {Object} req the HTTP request
 * @param {Object} res the HTTP response
 * @param {Object} result the operation result
 */
function setResHeaders(req, res, result) {
  const totalPages = Math.ceil(result.total / result.perPage);
  if (result.page > 1) {
    res.set("X-Prev-Page", result.page - 1);
  }
  if (result.page < totalPages) {
    res.set("X-Next-Page", result.page + 1);
  }
  res.set("X-Page", result.page);
  res.set("X-Per-Page", result.perPage);
  res.set("X-Total", result.total);
  res.set("X-Total-Pages", totalPages);
  // set Link header
  if (totalPages > 0) {
    let link = `<${getPageLink(req, 1)}>; rel="first", <${getPageLink(
      req,
      totalPages
    )}>; rel="last"`;
    if (result.page > 1) {
      link += `, <${getPageLink(req, result.page - 1)}>; rel="prev"`;
    }
    if (result.page < totalPages) {
      link += `, <${getPageLink(req, result.page + 1)}>; rel="next"`;
    }
    res.set("Link", link);
  }
}

/**
 * Return details about the current user.
 * @param {string} token the current user's token
 * @return {Object} details about the user
 */
async function getCurrentUserDetails(token) {
  const url = `${config.API.V5}/taas-teams/me`;
  const res = await request
    .get(url)
    .set("Authorization", token)
    .set("Accept", "application/json");
  localLogger.debug({
    context: "getCurrentUserDetails",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  return res.body;
}

/**
 * Return job candidates by given criteria
 * @param {string} criteria the search criteria
 * @return {Object} the list of job candidates with pagination headers
 */
async function getJobCandidates(criteria) {
  const token = await getM2MToken();
  let body = { statuses: [] };
  if (criteria.status) {
    body = constants.JOB_APPLICATION_STATUS_MAPPER[criteria.status] || {
      statuses: [],
    };
  }
  delete criteria.status;
  const url = `${config.API.V5}/jobCandidates`;
  const res = await request
    .get(url)
    .query(criteria)
    .send(body)
    .set("Authorization", `Bearer ${token}`)
    .set("Accept", "application/json");
  localLogger.debug({
    context: "getJobCandidates",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  return {
    total: Number(_.get(res.headers, "x-total")),
    page: Number(_.get(res.headers, "x-page")),
    perPage: Number(_.get(res.headers, "x-per-page")),
    result: res.body,
  };
}

/**
 * Process placed job candidate to calculate the completed status
 *
 * @param {*} jobCandidates
 * @param {*} userId
 * @returns
 */
async function handlePlacedJobCandidates(jobCandidates, userId, userHandle) {
  if (!jobCandidates || jobCandidates.length == 0 || !userId) {
    return;
  }
  const placedJobs = jobCandidates.filter(
    (item) => item.status == constants.MY_GIGS_JOB_STATUS.PLACED
  );
  if (placedJobs.length == 0) {
    return;
  }
  const token = await getM2MToken();
  const url = `${config.API.V5}/resourceBookings`;
  const criteria = {
    userId: userId,
    page: 1,
    perPage: placedJobs.length,
  };
  const body = {
    jobIds: _.map(placedJobs, "jobId"),
  };
  const res = await request
    .get(url)
    .query(criteria)
    .send(body)
    .set("Authorization", `Bearer ${token}`)
    .set("Accept", "application/json");
  localLogger.debug({
    context: "handlePlacedJobCandidates",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  if (res.body && res.body.length == 0) {
    return;
  }
  // Handle placed job status with RB result
  const rbRes = res.body;
  _.each(rbRes, (rb) => {
    const jc = jobCandidates.find(
      (item) => item.userId == rb.userId && item.jobId == rb.jobId
    );
    if (jc) {
      if (rb.endDate) {
        if (
          new Date(rb.endDate) < new Date() &&
          new Date(rb.endDate).toDateString() != new Date().toDateString()
        ) {
          jc.status = "completed";
          jc.rbStartDate = rb.startDate;
          jc.rbEndDate = rb.endDate;
          jc.rbId = rb.id;
          jc.userHandle = userHandle;
        }
      }
    }
  });
  await getWorkingPeriods(jobCandidates, userHandle, rbRes);
  return;
}

/**
 * Get payment Total for working period
 *
 * @param {*} jobCandidates job candidates we will process
 * @param {*} userHandle the user's handle
 * @param {*} resourceBookings the resource booking belongs to this user
 * @returns
 */
async function getWorkingPeriods(jobCandidates, userHandle, resourceBookings) {
  if (
    !userHandle ||
    !resourceBookings ||
    resourceBookings.length == 0 ||
    !jobCandidates ||
    jobCandidates.length == 0
  ) {
    return;
  }
  const rbIds = resourceBookings.map((item) => item.id);
  const token = await getM2MToken();
  const url = `${config.API.V5}/work-periods`;
  const criteria = {
    userHandle: userHandle,
    resourceBookingIds: rbIds.join(","),
  };
  const res = await request
    .get(url)
    .query(criteria)
    .set("Authorization", `Bearer ${token}`)
    .set("Accept", "application/json");
  localLogger.debug({
    context: "getWorkingPeriods",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  if (res.body && res.body.length == 0) {
    return;
  }
  // All the working periods for the rbs.
  const wpRes = res.body;
  _.each(rbIds, (rbId) => {
    const wps = wpRes.filter(
      (wp) => wp.userHandle == userHandle && wp.resourceBookingId == rbId
    );
    const paymentTotal = wps.reduce((total, wp) => total + wp.paymentTotal, 0);
    const jc = jobCandidates.find(
      (item) => item.rbId == rbId && item.userHandle == userHandle
    );
    if (jc) {
      jc.paymentTotal = paymentTotal;
    }
  });
}

/**
 * Return jobs by given criteria
 * @param {string} criteria the search criteria
 * @return {Object} the list of jobs with pagination headers
 */
async function getJobs(criteria) {
  let jobIds = [];
  let bodySkills = [];
  if (criteria.jobIds) {
    jobIds = criteria.jobIds;
    criteria = _.omit(criteria, "jobIds");
  }
  if (criteria.bodySkills) {
    bodySkills = criteria.bodySkills;
    criteria = _.omit(criteria, 'bodySkills');
  }
  const token = await getM2MToken();
  const url = `${config.API.V5}/jobs`;
  const res = await request
    .get(url)
    .query(criteria)
    .set("Authorization", `Bearer ${token}`)
    .set("Accept", "application/json")
    .send({ jobIds, bodySkills });
  localLogger.debug({
    context: "getJobs",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  return {
    total: Number(_.get(res.headers, "x-total")),
    page: Number(_.get(res.headers, "x-page")),
    perPage: Number(_.get(res.headers, "x-per-page")),
    result: res.body,
  };
}

/**
 * Get member details
 * @param {string} handle the handle of the user
 * @param {string} query the query criteria
 * @return {Object} the object of member details
 */
async function getMember(handle, query) {
  const token = await getM2MToken();
  const url = `${config.API.V5}/members/${handle}`;
  const res = await request
    .get(url)
    .query(query)
    .set("Authorization", `Bearer ${token}`)
    .set("Accept", "application/json");
  localLogger.debug({
    context: "getMember",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  return res.body;
}

/**
 * Get member traits info
 * @param {string} handle the handle of the user
 * @param {string} query the query criteria
 * @returns the object of member traitsdetails
 */
async function getMemberTraits(handle, query) {
  const token = await getM2MToken();
  const url = `${config.API.V5}/members/${handle}/traits`;
  const res = await request
    .get(url)
    .query(query)
    .set("Authorization", `Bearer ${token}`)
    .set("Accept", "application/json");
  localLogger.debug({
    context: "getMemberTraits",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  return res.body;
}
/**
 * Update member details
 * @param {string} handle the handle of the user
 * @param {object} data the data to be updated
 * @return {object} the object of updated member details
 */
async function updateMember(currentUser, data) {
  const token = currentUser.jwtToken;
  const url = `${config.API.V5}/members/${currentUser.handle}`;
  const res = await request
    .put(url)
    .set("Authorization", token)
    .set("Content-Type", "application/json")
    .set("Accept", "application/json")
    .send(data);
  localLogger.debug({
    context: "updateMember",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  return res.body;
}

/**
 * Update member traits
 * @param {string} handle the handle of the user
 * @param {object} data the data to be updated
 * @return {object} the object of updated member details
 */
async function updateMemberTraits(currentUser, data) {
  const token = currentUser.jwtToken;
  const url = `${config.API.V5}/members/${currentUser.handle}/traits`;
  const res = await request
    .put(url)
    .set("Authorization", token)
    .set("Content-Type", "application/json")
    .set("Accept", "application/json")
    .send(data);
  localLogger.debug({
    context: "updateMemberTraits",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  return res.body;
}

/**
 * Get Recruit CRM profile details
 * @param {object} currentUser the user who performs the operation
 * @return {object} the object of profile details
 */
async function getRCRMProfile(currentUser) {
  const token = currentUser.jwtToken;
  const url = `${config.RECRUIT_API}/api/recruit/profile`;
  const res = await request
    .get(url)
    .set("Authorization", token)
    .set("Accept", "application/json");
  localLogger.debug({
    context: "getRCRMProfile",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  return res.body;
}

/**
 * Update Recruit CRM profile details
 * @param {object} currentUser the user who performs the operation
 * @param {object} data the data to be updated
 * @param {object} file the resume file
 * @return {object} the returned object
 */
async function updateRCRMProfile(currentUser, data, file) {
  const token = currentUser.jwtToken;
  const url = `${config.RECRUIT_API}/api/recruit/profile`;
  let res = null;
  if (file) {
    res = await request
      .post(url)
      .set("Authorization", token)
      .set("Content-Type", "multipart/form-data")
      .set("Accept", "application/json")
      .field("phone", data.phone)
      .field("availability", data.availability)
      .field("city", data.city)
      .field("countryName", data.countryName)
      .attach("resume", file.data, file.name);
  } else {
    res = await request
      .post(url)
      .set("Authorization", token)
      .set("Content-Type", "multipart/form-data")
      .set("Accept", "application/json")
      .field("phone", data.phone)
      .field("availability", data.availability)
      .field("city", data.city)
      .field("countryName", data.countryName);
  }
  localLogger.debug({
    context: "updateRCRMProfile",
    message: `response body: ${JSON.stringify(res.body)}`,
  });
  return res.body;
}

module.exports = {
  errorHandler,
  interceptor,
  checkIfExists,
  autoWrapExpress,
  setResHeaders,
  getM2MToken,
  getCurrentUserDetails,
  getJobCandidates,
  handlePlacedJobCandidates,
  getJobs,
  getMember,
  getMemberTraits,
  updateMember,
  updateMemberTraits,
  getRCRMProfile,
  updateRCRMProfile,
};
