import {
  activeupdateOfferStatusById,
  checkOfferExist,
  createOffer,
  deleteOfferById,
  getActiveOffer,
  getAllOffer,
  getOfferById,
  getOfferByCategoryId,
  getOfferByProductId,
  getVisibleOffersByProductId,
  updateOfferById,
  getValidateOfferByName,
  getOfferUsageCount,
  isOfferMappedToScope,
  getOfferUsageByOfferId,
  getOfferUsageByUserId,
  getAllOfferUsageSummary,
  createOfferProductCategoryMapping,
  deleteOfferProductCategoryMappingById,
  getAllOfferProductCategoryMappings,
  getOfferProductCategoryMappingById,
  getOfferProductCategoryMappingsByOfferId,
  isOfferProductCategoryDuplicateOnUpdate,
  isOfferExistsById,
  isOfferProductCategoryMappingExists,
  updateOfferProductCategoryMappingById,
  getOfferTypeByIdWithoutActiveCheck,
} from "../models/offer.model.js";
import {
  getCartItemsWithProduct,
  getCartScopeDetails,
} from "../models/cart.model.js";
import {
  badRequest,
  conflict,
  created,
  notFound,
  ok,
  serverError,
} from "../utils/apiResponse.js";

// ============================================================================
// OFFER CONTROLLERS
// ============================================================================

// ============================================================================
// OFFER MASTER CONTROLLERS
// ============================================================================

/**
 * Create a new offer.
 * Flow:
 * - checks for conflicting offer in same scope/time window
 * - validates request payload presence (extra safety; primary validation is in middleware)
 * - persists offer record
 */
export const createOfferController = async (req, res) => {
  try {
    const offerData = req.body;
    const userId = req.user.id;

    if (!offerData || Object.keys(offerData).length === 0) {
      return badRequest(res, "Request body is required");
    }

    const now = new Date();
    const todayStr =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const currentTimeStr =
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0");

    // Unified Business Validation for Creation
    // 1. Minimum date/time checks
    if (offerData.start_date < todayStr) {
      return badRequest(res, "start_date cannot be in the past");
    }

    // 2. Date range check
    if (new Date(offerData.start_date) > new Date(offerData.end_date)) {
      return badRequest(res, "start_date must be before end_date");
    }

    // 3. Same day time check
    if (
      offerData.start_date === offerData.end_date &&
      offerData.start_time >= offerData.end_time
    ) {
      return badRequest(res, "start_time must be before end_time");
    }

    // 4. End time in future check
    if (
      offerData.end_date === todayStr &&
      offerData.end_time <= currentTimeStr
    ) {
      return badRequest(res, "end_time must be in the future for today");
    }

    // 5. Discount validation
    if (
      offerData.discount_type === "fixed_amount" &&
      offerData.maximum_discount_amount !== null &&
      offerData.maximum_discount_amount < offerData.discount_value
    ) {
      return badRequest(
        res,
        "maximum_discount_amount cannot be less than discount_value",
      );
    }

    // 6. AUTO-ADJUST START TIME для сегодня
    if (offerData.start_date === todayStr) {
      if (!offerData.start_time || offerData.start_time < currentTimeStr) {
        offerData.start_time = currentTimeStr;
      }
    }

    const exists = await checkOfferExist(offerData);
    if (exists) {
      return conflict(res, "Offer already exists in the same time slot");
    }

    const result = await createOffer(offerData, userId);
    const offerId = result.insertId;

    // 8. AUTO-CREATE mapping if IDs provided
    // This allows creating category/product offers in one request
    const hasProductId = offerData.product_id != null;
    const hasCategoryId = offerData.category_id != null;
    if (hasProductId || hasCategoryId) {
      await createOfferProductCategoryMapping(
        {
          offer_id: offerId,
          product_id: offerData.product_id ?? null,
          category_id: offerData.category_id ?? null,
          is_active: 1,
        },
        userId,
      );
    }

    return created(res, "Offer created successfully", {
      offer_id: offerId,
    });
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

// ============================================================================
// OFFER PRODUCT CATEGORY MAPPING CONTROLLERS
// ============================================================================

/**
 * Create offer-product/category mapping.
 * Rules:
 * - offer must exist and not be deleted
 * - exactly one of product_id/category_id is expected via validator
 * - duplicate active mapping for same offer-scope is blocked
 */
export const createOfferProductCategoryMappingController = async (req, res) => {
  try {
    const mappingData = req.body;
    const userId = req.user.id;

    const offer = await getOfferTypeByIdWithoutActiveCheck(
      mappingData.offer_id,
    );
    if (!offer) {
      return notFound(res, "Offer not found");
    }

    const hasProductId = mappingData.product_id != null;
    const hasCategoryId = mappingData.category_id != null;
    const isFlatDiscount = offer.offer_type === "flat_discount";

    if (isFlatDiscount && (hasProductId || hasCategoryId)) {
      return badRequest(
        res,
        "For flat_discount offers, product_id and category_id must be null",
      );
    }

    if (!isFlatDiscount && !hasProductId && !hasCategoryId) {
      return badRequest(
        res,
        "Either product_id or category_id is required for this offer type",
      );
    }

    if (!isFlatDiscount && hasProductId && hasCategoryId) {
      return badRequest(res, "Provide only one: product_id or category_id");
    }

    const mappingExists =
      await isOfferProductCategoryMappingExists(mappingData);
    if (mappingExists) {
      return conflict(res, "Offer mapping already exists");
    }

    const result = await createOfferProductCategoryMapping(mappingData, userId);
    const createdMapping = await getOfferProductCategoryMappingById(
      result.insertId,
    );

    return created(
      res,
      "Offer mapping created successfully",
      createdMapping[0],
    );
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Fetch all product/category mappings.
 */
export const getAllOfferProductCategoryMappingsController = async (
  req,
  res,
) => {
  try {
    const result = await getAllOfferProductCategoryMappings();
    return ok(res, "Offer mappings fetched successfully", result || []);
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Fetch all product/category mappings for a given offer id.
 */
export const getOfferProductCategoryMappingsByOfferIdController = async (
  req,
  res,
) => {
  try {
    const offerId = req.params.id;

    const offerExists = await isOfferExistsById(offerId);
    if (!offerExists) {
      return notFound(res, "Offer not found");
    }

    const result = await getOfferProductCategoryMappingsByOfferId(offerId);
    return ok(res, "Offer mappings fetched successfully", result || []);
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Update offer-product/category mapping by mapping id.
 * Supports:
 * - toggling is_active
 * - switching mapping scope product<->category
 * Duplicate scope for same offer is blocked.
 */
export const updateOfferProductCategoryMappingByIdController = async (
  req,
  res,
) => {
  try {
    const mappingId = req.params.id;
    const userId = req.user.id;
    const payload = req.body;

    const existing = await getOfferProductCategoryMappingById(mappingId);
    if (!existing || existing.length === 0) {
      return notFound(res, "Mapping not found");
    }

    const current = existing[0];

    // Validate that both product_id and category_id are not provided together.
    const hasProductId = Object.prototype.hasOwnProperty.call(
      payload,
      "product_id",
    );
    const hasCategoryId = Object.prototype.hasOwnProperty.call(
      payload,
      "category_id",
    );

    if (hasProductId && hasCategoryId) {
      return badRequest(
        res,
        "Cannot update both product_id and category_id in the same request. Provide only one scope.",
      );
    }

    // If one scope is provided, force the other to NULL to keep exactly one scope.
    const updateData = { ...payload };
    if (hasProductId) {
      updateData.category_id = null;
    }
    if (hasCategoryId) {
      updateData.product_id = null;
    }

    const finalProductId = Object.prototype.hasOwnProperty.call(
      updateData,
      "product_id",
    )
      ? updateData.product_id
      : current.product_id;
    const finalCategoryId = Object.prototype.hasOwnProperty.call(
      updateData,
      "category_id",
    )
      ? updateData.category_id
      : current.category_id;

    const hasDuplicate = await isOfferProductCategoryDuplicateOnUpdate(
      current.offer_id,
      finalProductId,
      finalCategoryId,
      mappingId,
    );
    if (hasDuplicate) {
      return conflict(res, "Offer mapping already exists");
    }

    const result = await updateOfferProductCategoryMappingById(
      mappingId,
      updateData,
      userId,
    );

    if (!result || result.affectedRows === 0) {
      return notFound(res, "Mapping not found or already deleted");
    }

    const updatedMapping = await getOfferProductCategoryMappingById(mappingId);

    return ok(res, "Offer mapping updated successfully", updatedMapping[0]);
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Soft delete mapping by mapping id.
 */
export const deleteOfferProductCategoryMappingByIdController = async (
  req,
  res,
) => {
  try {
    const mappingId = req.params.id;
    const userId = req.user.id;

    const result = await deleteOfferProductCategoryMappingById(
      mappingId,
      userId,
    );

    if (!result || result.affectedRows === 0) {
      return notFound(res, "Mapping not found or already deleted");
    }

    return ok(res, "Offer mapping deleted successfully");
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

// ============================================================================
// OFFER MASTER CONTROLLERS (CONTINUED)
// ============================================================================

/**
 * Fetch all offers (including active/inactive and soft-delete state as returned by model query).
 */
export const getAllOfferController = async (req, res) => {
  try {
    // Fetch all offers.
    const result = await getAllOffer();

    if (!result || result.length === 0) {
      return notFound(res, "No offers found");
    }

    return ok(res, `${result.length} Offers fetched successfully`, result);
  } catch (error) {
    console.error(error);

    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Fetch a single active, non-deleted offer by id.
 * Note: underlying model currently filters by `is_active=1` and `is_deleted=0`.
 */
export const getOfferByIdController = async (req, res) => {
  try {
    // Fetch a single offer by id.
    const offerId = req.params.id;
    const result = await getOfferById(offerId);

    if (!result || result.length === 0) {
      return notFound(res, "No offers found or deleted");
    }

    return ok(res, "Offer fetched successfully", result);
  } catch (error) {
    console.error(error);

    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Fetch all active, non-deleted offers mapped to a specific product id.
 */
export const getOfferByProductIdController = async (req, res) => {
  try {
    const productId = req.params.id;
    const result = await getOfferByProductId(productId);

    return ok(res, "Offers fetched successfully by product id", result || []);
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Fetch all active, non-deleted offers mapped to a specific category id.
 */
export const getOfferByCategoryIdController = async (req, res) => {
  try {
    const categoryId = req.params.id;
    const result = await getOfferByCategoryId(categoryId);

    return ok(res, "Offers fetched successfully by category id", result || []);
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Fetch both product-level and category-level active offers for a product id.
 */
export const getVisibleOffersByProductIdController = async (req, res) => {
  try {
    const productId = req.params.id;
    const result = await getVisibleOffersByProductId(productId);

    const productCount = result.product_offers?.length ?? 0;
    const categoryCount = result.category_offers?.length ?? 0;

    return ok(res, "Visible offers fetched successfully by product id", {
      product_offers: result.product_offers || [],
      category_offers: result.category_offers || [],
    });
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Update an offer by id with partial payload fields.
 * Validation middleware ensures payload shape before controller runs.
 */
export const updateOfferByIdController = async (req, res) => {
  try {
    const offerId = req.params.id;
    const offerData = req.body;
    const userId = req.user.id;

    // Fetch existing offer
    const existingOfferArray = await getOfferById(offerId);
    if (!existingOfferArray || existingOfferArray.length === 0) {
      return notFound(res, "Offer not found or already deleted");
    }
    const existingOffer = existingOfferArray[0];

    // Helper to normalize dates from DB for comparison
    const toDateStr = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return (
        d.getFullYear() +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(d.getDate()).padStart(2, "0")
      );
    };

    const now = new Date();
    const todayStr = toDateStr(now);
    const currentTimeStr =
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0");

    // Unified Business Validation for Updating
    const existingStartDateStr = toDateStr(existingOffer.start_date);
    const newStartDate = offerData.start_date || existingStartDateStr;
    const newEndDate = offerData.end_date || toDateStr(existingOffer.end_date);
    const newStartTime = offerData.start_time || existingOffer.start_time;
    const newEndTime = offerData.end_time || existingOffer.end_time;

    // 1. Date range check
    if (new Date(newStartDate) > new Date(newEndDate)) {
      return badRequest(res, "start_date must be before end_date");
    }

    // 2. Same day time check
    if (newStartDate === newEndDate && newStartTime >= newEndTime) {
      return badRequest(res, "start_time must be before end_time");
    }

    // 3. Discount validation
    const discountType = offerData.discount_type || existingOffer.discount_type;
    const discountValue =
      offerData.discount_value !== undefined
        ? offerData.discount_value
        : existingOffer.discount_value;
    const maxDiscount =
      offerData.maximum_discount_amount !== undefined
        ? offerData.maximum_discount_amount
        : existingOffer.maximum_discount_amount;

    if (
      discountType === "fixed_amount" &&
      maxDiscount !== null &&
      maxDiscount < discountValue
    ) {
      return badRequest(
        res,
        "maximum_discount_amount cannot be less than discount_value",
      );
    }

    // 4. Offer-Active Check: Don't allow changing start_date to the past
    if (offerData.start_date && offerData.start_date < todayStr) {
      return badRequest(res, "Cannot set start_date to the past");
    }

    // 5. AUTO-ADJUST START TIME
    // If user sets date to today, ensure time isn't in past
    if (newStartDate === todayStr) {
      // Compare with normalized time strings (HH:mm)
      const startTimeToCompare = newStartTime?.substring(0, 5);

      if (startTimeToCompare < currentTimeStr) {
        // If they explicitly trying to set a new start_date to today, or if they explicitly set a brand new past time, we bump it.
        // If it was already today and they didn't touch the date/time, we leave it (it already started).
        const dateChanged =
          offerData.start_date && offerData.start_date !== existingStartDateStr;

        const existingStartTimeStr = existingOffer.start_time?.substring(0, 5);
        const timeChanged =
          offerData.start_time &&
          offerData.start_time?.substring(0, 5) !== existingStartTimeStr;

        if (dateChanged || timeChanged) {
          offerData.start_time = currentTimeStr;
        }
      }
    }

    const result = await updateOfferById(offerId, offerData, userId);

    // After updating offer_master, we need to handle product/category mappings
    // if the offer_type was changed or if specific IDs were provided.
    const hasProductId = offerData.product_id != null;
    const hasCategoryId = offerData.category_id != null;

    // Define which types REQUIRE a mapping entry
    const scopedTypes = ["category_discount", "product_discount"];
    const targetType = offerData.offer_type || existingOffer.offer_type;
    const isScoped = scopedTypes.includes(targetType);

    if (offerData.offer_type || hasProductId || hasCategoryId) {
      // Fetch current mappings
      const existingMappings =
        await getOfferProductCategoryMappingsByOfferId(offerId);

      if (!isScoped) {
        // If it's NOT a scoped discount (e.g. flat, first_order, time_based),
        // remove any specific product/category mappings to keep DB clean
        if (existingMappings && existingMappings.length > 0) {
          for (const mapping of existingMappings) {
            await deleteOfferProductCategoryMappingById(mapping.id, userId);
          }
        }
      } else {
        // It's a scoped discount (product or category), needs a mapping
        // We use either the new IDs provided or fallback to existing mapping if it's there
        let targetProductId = offerData.product_id;
        let targetCategoryId = offerData.category_id;

        if (existingMappings && existingMappings.length > 0) {
          // Update the first existing mapping
          const firstMapping = existingMappings[0];

          // If IDs weren't provided in the update, keep the old ones from the first mapping
          if (targetProductId === undefined)
            targetProductId = firstMapping.product_id;
          if (targetCategoryId === undefined)
            targetCategoryId = firstMapping.category_id;

          await updateOfferProductCategoryMappingById(
            firstMapping.id,
            {
              product_id: targetProductId ?? null,
              category_id: targetCategoryId ?? null,
              is_active: 1,
            },
            userId,
          );
          // Delete extras if any
          for (let i = 1; i < existingMappings.length; i++) {
            await deleteOfferProductCategoryMappingById(
              existingMappings[i].id,
              userId,
            );
          }
        } else {
          // No mapping exists but we are now a scoped discount, so create one
          // Even if IDs are null, we create it (though validator usually prevents this for scoped)
          await createOfferProductCategoryMapping(
            {
              offer_id: offerId,
              product_id: targetProductId ?? null,
              category_id: targetCategoryId ?? null,
              is_active: 1,
            },
            userId,
          );
        }
      }
    }

    // `affectedRows = 0` means id not found or soft-deleted.
    if (!result || result.affectedRows === 0) {
      return notFound(res, "Offer not found or already deleted");
    }

    return ok(res, "Offer updated successfully");
  } catch (error) {
    console.error(error);

    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Soft delete an offer by id (`is_deleted=1`).
 */
export const deleteOfferByIdController = async (req, res) => {
  try {
    const offerId = req.params.id;
    const userId = req.user.id;
    const result = await deleteOfferById(offerId, userId);

    // Soft delete only works when row exists and is not already deleted.
    if (!result || result.affectedRows === 0) {
      return notFound(res, "No offers found");
    }

    return ok(res, "Offer deleted successfully");
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Update offer active status (`is_active` = 0 or 1).
 * Used by admin to activate/deactivate an offer without deleting it.
 */
export const updateOfferStatusController = async (req, res) => {
  try {
    const offerId = req.params.id;
    const isActive = req.body.is_active;
    const userId = req.user.id;

    const result = await activeupdateOfferStatusById(isActive, offerId, userId);

    // No target row matched for update.
    if (!result || result.affectedRows === 0) {
      return notFound(res, "No offers found");
    }

    return ok(
      res,
      isActive === 1
        ? "Offer activated successfully"
        : "Offer deactivated successfully",
    );
  } catch (error) {
    console.error(error);
    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Fetch all active offers.
 * Returns offers where `is_active=1` and `is_deleted=0`.
 */
export const getActiveOfferController = async (req, res) => {
  try {
    const result = await getActiveOffer();

    if (!result || result.length === 0) {
      return notFound(res, "No offers found");
    }

    return ok(
      res,
      `${result.length} Active Offers fetched successfully`,
      result,
    );
  } catch (error) {
    console.error(error);

    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Validate whether an offer can be applied for the current order context.
 * Checks:
 * - active/non-expired offer in matching scope
 * - minimum purchase amount
 * - per-user usage limit
 * - discount amount and final payable total
 */
export const validateOfferController = async (req, res) => {
  try {
    // User ID comes from authenticated request context
    const userId = req.user.id;

    // Body is pre-validated by `validateOfferPayload` middleware.
    const { offer_name, product_id, category_id } = req.body;

    // Step 0: Get cart total from database only (never trust client amount).
    if (!req.cart || !req.cart.cart_id) {
      return badRequest(res, "Cart context is required to validate offer");
    }
    const cartItems = await getCartItemsWithProduct(req.cart.cart_id);
    const cartTotal = cartItems.reduce(
      (sum, item) => sum + Number(item.effective_price) * item.quantity,
      0,
    );

    // Step 1: Fetch a currently valid offer.
    const result = await getValidateOfferByName(offer_name);

    if (!result || result.length === 0) {
      return badRequest(res, "Offer not valid or expired");
    }

    const offer = result[0];

    // Step 2: Product/category scope check is required only for scoped offer types.
    const requiresScopeMapping =
      offer.offer_type === "product_discount" ||
      offer.offer_type === "category_discount";

    if (requiresScopeMapping) {
      if (!product_id && !category_id) {
        return badRequest(
          res,
          "Either product_id or category_id is required for this offer type",
        );
      }

      if (product_id && category_id) {
        return badRequest(res, "Provide only one: product_id or category_id");
      }

      const { productIds, categoryIds } = await getCartScopeDetails(
        req.cart.cart_id,
      );

      if (product_id && !productIds.includes(Number(product_id))) {
        return badRequest(
          res,
          "Provided product_id is not present in the user's cart",
        );
      }

      if (category_id && !categoryIds.includes(Number(category_id))) {
        return badRequest(
          res,
          "Provided category_id is not present in the user's cart",
        );
      }

      const hasScopeMapping = await isOfferMappedToScope(
        offer.offer_id,
        product_id ?? null,
        category_id ?? null,
      );
      if (!hasScopeMapping) {
        return badRequest(
          res,
          "Offer is not applicable for provided product/category",
        );
      }
    }

    // Step 3: Enforce minimum purchase amount if configured.
    if (offer.min_purchase_amount && cartTotal < offer.min_purchase_amount) {
      return badRequest(
        res,
        `Minimum purchase amount is ${offer.min_purchase_amount}`,
      );
    }

    // Step 4: Enforce per-user usage limit if configured.
    if (offer.usage_limit_per_user) {
      const usageCount = await getOfferUsageCount(offer.offer_id, userId);

      if (usageCount >= offer.usage_limit_per_user) {
        return badRequest(res, "Offer usage limit exceeded");
      }
    }

    // Step 5: Calculate discount and final amount.
    let discountAmount = 0;
    const type = offer.discount_type.toLowerCase();

    if (type === "percentage") {
      discountAmount = (cartTotal * offer.discount_value) / 100;

      if (
        offer.maximum_discount_amount &&
        discountAmount > offer.maximum_discount_amount
      ) {
        discountAmount = offer.maximum_discount_amount;
      }
    } else if (type === "fixed_amount") {
      discountAmount = Math.min(offer.discount_value, cartTotal);
    }

    // Consumer/order module should persist usage in `offer_usage` after successful order placement.
    return ok(res, "Offer is valid", {
      offer_id: offer.offer_id,
      discount_amount: discountAmount,
      final_amount: cartTotal - discountAmount,
    });
  } catch (error) {
    console.error(error);

    return serverError(res, error.message || "Internal server error");
  }
};

// ============================================================================
// OFFER USAGE CONTROLLERS
// ============================================================================

/**
 * Fetch usage history rows for a given offer id.
 */
export const getOfferUsageByOfferIdController = async (req, res) => {
  try {
    // Route param `id` here represents `offer_id`.
    const offerId = req.params.id;

    const result = await getOfferUsageByOfferId(offerId);

    return ok(res, `Found ${result.length} usage records for this offer`, {
      usage_details: result,
    });
  } catch (error) {
    console.error(error);

    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Fetch usage history rows for a given user id.
 * Response includes both count and detailed usage rows.
 */
export const getOfferUsageByUserIdController = async (req, res) => {
  try {
    // Route param `id` here represents `user_id`.
    const userId = req.params.id;

    const result = await getOfferUsageByUserId(userId);

    if (!result || result.length === 0) {
      return notFound(res, "No usage found for this offer by given user id");
    }

    return ok(res, `Offer used ${result.length} times by given user id`, {
      total_usage: result.length,
      usage_details: result,
    });
  } catch (error) {
    console.error(error);

    return serverError(res, error.message || "Internal server error");
  }
};

/**
 * Fetch aggregated usage analytics for all offers.
 * Intended for admin/reporting dashboards.
 */
export const getAllOfferUsageSummaryController = async (req, res) => {
  try {
    const result = await getAllOfferUsageSummary();

    return ok(res, "Offer usage summary fetched successfully", result);
  } catch (error) {
    console.error(error);

    return serverError(res, error.message || "Internal server error");
  }
};
