"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PRICING = exports.MODEL_PRICING = exports.ApiErrorKind = void 0;
exports.getModelPricing = getModelPricing;
exports.calculateCost = calculateCost;
exports.isDeepSeekBalanceResponse = isDeepSeekBalanceResponse;
exports.isUsageRecord = isUsageRecord;
exports.parseBalanceString = parseBalanceString;
/** Error categories for the API layer */
var ApiErrorKind;
(function (ApiErrorKind) {
    ApiErrorKind["Network"] = "Network";
    ApiErrorKind["InvalidKey"] = "InvalidKey";
    ApiErrorKind["RateLimited"] = "RateLimited";
    ApiErrorKind["ServerError"] = "ServerError";
    ApiErrorKind["MalformedResponse"] = "MalformedResponse";
    ApiErrorKind["Timeout"] = "Timeout";
})(ApiErrorKind || (exports.ApiErrorKind = ApiErrorKind = {}));
exports.MODEL_PRICING = {
    'deepseek-chat': { inputPrice: 1.0, outputPrice: 2.0, cacheHitPrice: 0.1 },
    'deepseek-v3': { inputPrice: 1.0, outputPrice: 2.0, cacheHitPrice: 0.1 },
    'deepseek-reasoner': { inputPrice: 4.0, outputPrice: 16.0, cacheHitPrice: 0.4 },
    'deepseek-r1': { inputPrice: 4.0, outputPrice: 16.0, cacheHitPrice: 0.4 },
};
/** Fallback pricing for unknown models */
exports.DEFAULT_PRICING = {
    inputPrice: 1.0,
    outputPrice: 2.0,
    cacheHitPrice: 0.1,
};
function getModelPricing(model) {
    return exports.MODEL_PRICING[model] ?? exports.DEFAULT_PRICING;
}
/** Calculate cost for a single usage record based on model pricing */
function calculateCost(tokens, model) {
    const pricing = getModelPricing(model);
    const cacheHit = tokens.cacheHit ?? 0;
    const cacheMiss = tokens.cacheMiss ?? tokens.prompt - cacheHit;
    const inputCost = (cacheHit / 1_000_000) * pricing.cacheHitPrice +
        (cacheMiss / 1_000_000) * pricing.inputPrice;
    const outputCost = (tokens.completion / 1_000_000) * pricing.outputPrice;
    return inputCost + outputCost;
}
// ---------------------------------------------------------------
//  Type guards
// ---------------------------------------------------------------
function isDeepSeekBalanceResponse(obj) {
    if (typeof obj !== 'object' || obj === null) {
        return false;
    }
    const o = obj;
    if (typeof o.is_available !== 'boolean') {
        return false;
    }
    if (!Array.isArray(o.balance_infos)) {
        return false;
    }
    for (const info of o.balance_infos) {
        if (typeof info !== 'object' || info === null) {
            return false;
        }
        const i = info;
        if (typeof i.currency !== 'string')
            return false;
        if (typeof i.total_balance !== 'string')
            return false;
        if (typeof i.granted_balance !== 'string')
            return false;
        if (typeof i.topped_up_balance !== 'string')
            return false;
    }
    return true;
}
function isUsageRecord(obj) {
    if (typeof obj !== 'object' || obj === null)
        return false;
    const o = obj;
    return (typeof o.prompt_tokens === 'number' &&
        typeof o.completion_tokens === 'number' &&
        typeof o.model === 'string');
}
function parseBalanceString(value) {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
}
//# sourceMappingURL=types.js.map