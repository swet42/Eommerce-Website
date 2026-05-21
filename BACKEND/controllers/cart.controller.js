import pool from "../configs/db.js";

import {
  getOrCreateCartByUserId,
  getCartItemsWithProduct,
  findCartItem,
  insertCartItem,
  insertCartItemModifiers,
  updateCartItemQuantity,
  deleteCartItem,
  clearCartItems,
  getProductPricing,
  getPortionPricing,
  getCombinationPricing,
  getFirstAvailablePortion,
  getMultipleModifierPricing,
} from "../models/cart.model.js";

import {
  getCartWithOffer,
  getCartItemsWithOffer,
  getApplicableOffersForProduct,
  getApplicableCartOffers,
  getOfferUsageCount,
  applyOfferToCart,
  applyOfferToCartItem,
  removeOfferFromCart,
  removeOfferFromCartItem,
} from "../models/offer.model.js";

import { getRootCategoryId } from "../models/Order_master.model.js";

import {
  ok,
  created,
  badRequest,
  unauthorized,
  notFound,
  serverError,
} from "../utils/apiResponse.js";

/**

 * Parse and validate positive integer values

 * @param {string|number} value - Value to parse

 * @returns {number|null} Parsed integer or null if invalid

 */

function parsePositiveInt(value) {
  const num = Number.parseInt(value, 10);

  if (Number.isNaN(num) || num <= 0) {
    return null;
  }

  return num;
}

// Find root category ID for tax calculation
const findRootCategory = async (categoryId) => {
  const rows = await getRootCategoryId(categoryId);
  return rows[0]?.category_id;
};

// Get tax percentage based on root category
const getTaxPercent = (rootCategoryId) => {
  const TAX_RULES = {
    1: 18, // Category 1: 18% tax
    27: 5, // Category 27: 5% tax
  };
  return TAX_RULES[rootCategoryId] || 0;
};

// Calculate tax for cart items
const calculateCartTax = async (items) => {
  if (!items || items.length === 0) {
    return { items: [], totalTax: 0 };
  }

  // Get unique category IDs to find their roots
  const categoryIds = [...new Set(items.map((item) => item.category_id))];

  // Get root categories for tax calculation
  const rootCategoryEntries = await Promise.all(
    categoryIds.map(async (catId) => {
      const rootId = await findRootCategory(catId);
      return [catId, rootId];
    }),
  );
  const categoryRootMap = Object.fromEntries(rootCategoryEntries);

  // Calculate tax for each item
  let totalTax = 0;
  const itemsWithTax = items.map((item) => {
    const rootCategoryId = categoryRootMap[item.category_id];
    const taxPercent = getTaxPercent(rootCategoryId);
    const itemPrice = Number(item.effective_price) * item.quantity;
    const taxAmount = (itemPrice * taxPercent) / 100;
    totalTax += taxAmount;

    return {
      ...item,
      tax_percent: taxPercent,
      tax_amount: Math.round(taxAmount * 100) / 100,
    };
  });

  return {
    items: itemsWithTax,
    totalTax: Math.round(totalTax * 100) / 100,
  };
};

/**

 * Calculate discount amount based on offer details

 * @param {Object} offer - Offer details

 * @param {number} subtotal - Subtotal amount

 * @returns {number} Discount amount

 */

function calculateDiscount(offer, subtotal) {
  if (!offer) return 0;

  const discountType = offer.discount_type.toLowerCase();

  let discountAmount = 0;

  if (discountType === "percentage") {
    discountAmount = (subtotal * offer.discount_value) / 100;

    if (
      offer.maximum_discount_amount &&
      discountAmount > offer.maximum_discount_amount
    ) {
      discountAmount = offer.maximum_discount_amount;
    }
  } else if (discountType === "fixed_amount") {
    discountAmount = Math.min(offer.discount_value, subtotal);
  }

  return Math.round(discountAmount * 100) / 100;
}

/**

 * Build cart response object with totals and offer details

 * @param {number} cartId - Cart ID

 * @param {Array} items - Cart items with product details

 * @param {Object} cartOffer - Cart-level offer details (optional)

 * @returns {Object} Cart response with items, subtotal, discount, total

 */

export async function buildCartResponse(cartId, items, cartOffer = null) {
  // Calculate tax for items first
  const { items: itemsWithTax, totalTax } = await calculateCartTax(items);

  // Calculate item-level discounts

  let subtotal = 0;

  let totalItemDiscount = 0;

  let itemsWithDiscount = await Promise.all(
    itemsWithTax.map(async (item) => {
      const itemPrice = Number(item.effective_price);

      const lineTotal = itemPrice * item.quantity;

      subtotal += lineTotal;

      let itemDiscount = 0;

      let appliedItemOffer = null;

      // Apply item-level offer if available

      if (item.item_offer_id && item.item_offer_name) {
        const itemOffer = {
          offer_id: item.item_offer_id,

          offer_name: item.item_offer_name,

          offer_type: item.item_offer_type,

          discount_type: item.item_discount_type,

          discount_value: item.item_discount_value,

          maximum_discount_amount: item.item_max_discount,
        };

        itemDiscount = calculateDiscount(itemOffer, lineTotal);

        totalItemDiscount += itemDiscount;

        appliedItemOffer = {
          offer_id: itemOffer.offer_id,

          offer_name: itemOffer.offer_name,

          discount_amount: itemDiscount,
        };
      }

      return {
        cartItemId: item.cart_item_id,

        productId: item.product_id,

        categoryId: item.category_id,
        categoryIds: await getCategoryAncestors(item.category_id),

        productName: item.display_name,

        image_url: item.image_url || null,

        shortDescription: item.short_description,

        quantity: item.quantity,

        price: itemPrice,

        lineTotal: lineTotal,

        portionPrice: item.portion_price ? Number(item.portion_price) : null,

        portionDiscountedPrice: item.portion_discounted_price
          ? Number(item.portion_discounted_price)
          : null,

        portionId: item.portion_id,

        portionValue: item.portion_value,

        combinationId: item.combination_id ?? null,

        combinationName: item.combination_name ?? null,

        modifiers: item.modifiers || [],

        appliedOffer: appliedItemOffer,

        discountedLineTotal: lineTotal - itemDiscount,

        taxPercent: item.tax_percent,

        taxAmount: item.tax_amount,
      };
    }),
  );

  // Calculate cart-level discount

  let cartDiscount = 0;

  let appliedCartOffer = null;

  if (cartOffer) {
    // Check if offer can be applied

    if (
      cartOffer.min_purchase_amount &&
      subtotal < cartOffer.min_purchase_amount
    ) {
      // Offer not applicable due to minimum purchase requirement

      cartOffer = null;
    } else {
      // Calculate effective subtotal for scoped offers (category/product)
      let applicableSubtotal = subtotal;

      if (
        cartOffer.offer_type === "category_discount" ||
        cartOffer.offer_type === "product_discount"
      ) {
        applicableSubtotal = 0;
        itemsWithDiscount = itemsWithDiscount.map((item) => {
          const isMatch = (cartOffer.mappings || []).some(
            (m) =>
              (cartOffer.offer_type === "product_discount" &&
                item.productId === m.product_id) ||
              (cartOffer.offer_type === "category_discount" &&
                (item.categoryId === m.category_id ||
                  (item.categoryIds &&
                    item.categoryIds.includes(m.category_id)))),
          );
          if (isMatch) {
            applicableSubtotal += item.lineTotal;
          }
          return {
            ...item,
            isMatchedByCartOffer: isMatch,
          };
        });
      }

      cartDiscount = calculateDiscount(cartOffer, applicableSubtotal);

      appliedCartOffer = {
        offer_id: cartOffer.offer_id,
        offer_name: cartOffer.offer_name,
        discount_amount: cartDiscount,
      };

      // Distribute cart discount among matched items
      if (cartDiscount > 0 && applicableSubtotal > 0) {
        const ratio = cartDiscount / applicableSubtotal;
        itemsWithDiscount = itemsWithDiscount.map((item) => {
          if (item.isMatchedByCartOffer) {
            const share = Math.round(item.lineTotal * ratio * 100) / 100;
            return {
              ...item,
              cartDiscountShare: share,
            };
          }
          return item;
        });
      }
    }
  }

  // Add totalLineDiscount to each item for easier order processing
  itemsWithDiscount = itemsWithDiscount.map((item) => ({
    ...item,
    totalLineDiscount:
      (item.appliedOffer?.discount_amount || 0) + (item.cartDiscountShare || 0),
  }));

  const totalDiscount = totalItemDiscount + cartDiscount;

  const total = Math.max(0, subtotal + totalTax - totalDiscount);

  return {
    cartId,

    items: itemsWithDiscount,

    subtotal: Math.round(subtotal * 100) / 100,

    tax: totalTax,

    itemDiscount: Math.round(totalItemDiscount * 100) / 100,

    cartDiscount: Math.round(cartDiscount * 100) / 100,

    discount: Math.round(totalDiscount * 100) / 100,

    total: Math.round(total * 100) / 100,

    appliedCartOffer,
  };
}

/**

 * Get current user's cart

 * Requires authentication (userId from JWT token)

 * 

 * GET /api/cart

 * Headers: Authorization: Bearer <token>

 */

async function getCart(req, res) {
  try {
    // Cart is attached by validateCart middleware
    const cartId = req.cart.cart_id;
    const userId = req.user.id;

    // Get cart with offer details
    const cartData = await getCartWithOffer(cartId);
    if (!cartData.length) {
      return notFound(res, "Cart not found");
    }

    // Group mappings if multiple exist for the same offer
    const cart = {
      ...cartData[0],
      mappings: cartData
        .filter((row) => row.product_id || row.category_id)
        .map((row) => ({
          product_id: row.product_id,
          category_id: row.category_id,
        })),
    };

    // Get cart items with offer details
    const items = await getCartItemsWithOffer(cartId);

    // Build response with offer calculations
    const cartOffer = cart.offer_id
      ? {
          offer_id: cart.offer_id,
          offer_name: cart.offer_name,
          offer_type: cart.offer_type,
          discount_type: cart.discount_type,
          discount_value: cart.discount_value,
          maximum_discount_amount: cart.maximum_discount_amount,
          min_purchase_amount: cart.min_purchase_amount,
          usage_limit_per_user: cart.usage_limit_per_user,
          mappings: cart.mappings,
        }
      : null;

    const response = await buildCartResponse(cartId, items, cartOffer);

    return ok(res, "Cart retrieved successfully", response);
  } catch (err) {
    console.error("Error in getCart:", err);
    return serverError(res, "Internal server error");
  }
}

/**

 * Add item to cart (add quantity if already present)

 * Requires authentication (userId from JWT token)

 * 

 * POST /api/cart/items

 * Headers: Authorization: Bearer <token>

 * Body: { productId, quantity, portionId?, modifierId? }

 */

async function addItemToCart(req, res) {
  try {
    const userId = req.user.id;
    const { productId, quantity, portionId, combinationId, modifierIds } =
      req.body;

    const parsedProductId = parsePositiveInt(productId);
    const parsedQuantity = parsePositiveInt(quantity);
    const parsedPortionId = portionId ? parsePositiveInt(portionId) : null;
    const parsedCombinationId = combinationId
      ? parsePositiveInt(combinationId)
      : null;

    if (!parsedProductId || !parsedQuantity) {
      return badRequest(res, "Invalid productId or quantity");
    }

    const pricing = await getProductPricing(parsedProductId);
    if (!pricing) {
      return notFound(res, "Product not found or inactive");
    }

    let itemPrice = Number(pricing.price);
    let finalPortionId = parsedPortionId;

    // Validate portion or auto-select first available
    if (parsedPortionId) {
      const portionPricing = await getPortionPricing(parsedPortionId);
      if (!portionPricing) {
        return badRequest(res, "Invalid portion specified.");
      }
      itemPrice = Number(portionPricing.price);
    } else {
      const defaultPortion = await getFirstAvailablePortion(parsedProductId);
      if (defaultPortion) {
        finalPortionId = defaultPortion.productPortionId;
        itemPrice = Number(defaultPortion.price);
      }
    }

    // Validate combination
    if (parsedCombinationId) {
      const comboPricing = await getCombinationPricing(parsedCombinationId);
      if (!comboPricing) {
        return badRequest(res, "Selected combination is unavailable.");
      }
      itemPrice =
        Math.round((itemPrice + comboPricing.additionalPrice) * 100) / 100;
    }

    // Handle Raw Modifiers
    let modifierKey = null;
    let rawModifiersTotal = 0;
    if (modifierIds && Array.isArray(modifierIds) && modifierIds.length > 0) {
      const modifierDetails = await getMultipleModifierPricing(modifierIds);
      if (modifierDetails.length !== modifierIds.length) {
        return badRequest(
          res,
          "One or more selected modifiers are invalid or inactive.",
        );
      }
      rawModifiersTotal = modifierDetails.reduce(
        (sum, m) => sum + Number(m.additional_price),
        0,
      );
      modifierKey = modifierIds.sort((a, b) => a - b).join("-");
      itemPrice = Math.round((itemPrice + rawModifiersTotal) * 100) / 100;
    }

    const existingItem = await findCartItem(
      req.cart.cart_id,
      parsedProductId,
      finalPortionId,
      parsedCombinationId,
      modifierKey,
    );

    let cartItemId;
    if (existingItem) {
      cartItemId = existingItem.cart_item_id;
      const newQuantity = existingItem.quantity + parsedQuantity;
      await updateCartItemQuantity(cartItemId, newQuantity, userId);
    } else {
      cartItemId = await insertCartItem({
        cartId: req.cart.cart_id,
        productId: parsedProductId,
        quantity: parsedQuantity,
        price: itemPrice,
        productPortionId: finalPortionId,
        combinationId: parsedCombinationId,
        modifierKey: modifierKey,
        userId,
      });

      // Insert into join table
      if (modifierIds && modifierIds.length > 0) {
        await insertCartItemModifiers(cartItemId, modifierIds);
      }
    }

    const items = await getCartItemsWithOffer(req.cart.cart_id);

    // Get current cart-level offer if any to include in the response
    const cartData = await getCartWithOffer(req.cart.cart_id);
    const cartOffer =
      cartData.length > 0 && cartData[0].offer_id
        ? {
            ...cartData[0],
            mappings: cartData
              .filter((row) => row.product_id || row.category_id)
              .map((row) => ({
                product_id: row.product_id,
                category_id: row.category_id,
              })),
          }
        : null;

    const response = await buildCartResponse(
      req.cart.cart_id,
      items,
      cartOffer,
    );
    return created(res, "Item added to cart", response);
  } catch (err) {
    console.error("Error in addItemToCart:", err);
    return serverError(res, "Internal server error");
  }
}

/**

 * Update quantity for a specific cart item (0 = remove)

 * Requires authentication (userId from JWT token)

 * 

 * PATCH /api/cart/items/:cartItemId

 * Headers: Authorization: Bearer <token>

 * Body: { quantity }

 */

async function updateCartItem(req, res) {
  try {
    // User ID comes from JWT token (authMiddleware)
    const userId = req.user.id;

    // Cart and cartItem are attached by middleware
    const cartItem = req.cartItem;

    const { quantity } = req.body;

    const parsedQuantity = parsePositiveInt(quantity);

    if (parsedQuantity === null) {
      return badRequest(res, "Invalid quantity");
    }

    // Cart item ownership is validated by middleware
    const cartItemId = req.cartItem.cart_item_id;

    if (parsedQuantity === 0) {
      await deleteCartItem(cartItemId, userId);
    } else {
      await updateCartItemQuantity(cartItemId, parsedQuantity, userId);
    }

    const updatedItems = await getCartItemsWithOffer(req.cart.cart_id);

    // Get current cart-level offer if any to include in the response
    const cartData = await getCartWithOffer(req.cart.cart_id);
    const cartOffer =
      cartData.length > 0 && cartData[0].offer_id
        ? {
            ...cartData[0],
            mappings: cartData
              .filter((row) => row.product_id || row.category_id)
              .map((row) => ({
                product_id: row.product_id,
                category_id: row.category_id,
              })),
          }
        : null;

    const response = await buildCartResponse(
      req.cart.cart_id,
      updatedItems,
      cartOffer,
    );

    return ok(res, "Cart item updated", response);
  } catch (err) {
    console.error("Error in updateCartItem:", err);

    return serverError(res, "Internal server error");
  }
}

/**

 * Remove a cart item

 * Requires authentication (userId from JWT token)

 * 

 * DELETE /api/cart/items/:cartItemId

 * Headers: Authorization: Bearer <token>

 */

async function removeCartItem(req, res) {
  try {
    // User ID comes from JWT token (authMiddleware)
    const userId = req.user.id;

    // Cart item ownership is validated by middleware
    const cartItemId = req.cartItem.cart_item_id;

    await deleteCartItem(cartItemId, userId);

    const updatedItems = await getCartItemsWithOffer(req.cart.cart_id);

    // Get current cart-level offer if any to include in the response
    const cartData = await getCartWithOffer(req.cart.cart_id);
    const cartOffer =
      cartData.length > 0 && cartData[0].offer_id
        ? {
            ...cartData[0],
            mappings: cartData
              .filter((row) => row.product_id || row.category_id)
              .map((row) => ({
                product_id: row.product_id,
                category_id: row.category_id,
              })),
          }
        : null;

    const response = await buildCartResponse(
      req.cart.cart_id,
      updatedItems,
      cartOffer,
    );

    return ok(res, "Cart item removed", response);
  } catch (err) {
    console.error("Error in removeCartItem:", err);

    return serverError(res, "Internal server error");
  }
}

/**

 * Apply offer to cart (cart-level offer)

 * POST /api/cart/offer

 * Headers: Authorization: Bearer <token>

 * Body: { offer_id }

 */

async function applyCartOffer(req, res) {
  try {
    const userId = req.user.id;

    const cartId = req.cart.cart_id;

    const { offer_id, offerId } = req.body;

    const offerIdFinal = offer_id || offerId;

    if (!offerIdFinal) {
      return badRequest(res, "offer_id is required");
    }

    const parsedOfferId = parsePositiveInt(offerIdFinal);

    if (!parsedOfferId) {
      return badRequest(res, "Invalid offer_id");
    }

    // Get cart items to calculate subtotal

    const items = await getCartItemsWithOffer(cartId);

    const subtotal = items.reduce(
      (sum, item) => sum + Number(item.effective_price) * item.quantity,
      0,
    );

    // Get offer details to validate
    const [offerDetails] = await pool.query(
      `SELECT * FROM offer_master 
       WHERE offer_id = ? 
       AND is_active = 1 
       AND is_deleted = 0
       AND CURDATE() BETWEEN start_date AND end_date`,
      [parsedOfferId],
    );

    if (!offerDetails.length) {
      return badRequest(res, "Offer not found, not active, or expired today");
    }

    const offer = offerDetails[0];

    // Check time-based offer
    if (offer.start_time && offer.end_time) {
      const now = new Date();
      const currentTime = now.toTimeString().slice(0, 5);
      if (currentTime < offer.start_time || currentTime > offer.end_time) {
        return badRequest(res, "Offer is not valid at this time");
      }
    }

    // Check minimum purchase amount
    if (offer.min_purchase_amount && subtotal < offer.min_purchase_amount) {
      return badRequest(
        res,
        `Minimum purchase amount is ${offer.min_purchase_amount}`,
      );
    }

    // Check usage limit
    if (offer.usage_limit_per_user) {
      const usageCount = await getOfferUsageCount(parsedOfferId, userId);
      if (usageCount >= offer.usage_limit_per_user) {
        return badRequest(res, "Offer usage limit exceeded");
      }
    }

    // Check if offer is applicable to cart items
    if (
      offer.offer_type === "category_discount" ||
      offer.offer_type === "product_discount"
    ) {
      // Get applicable offers for cart
      const applicableOffers = await getApplicableCartOffers();
      const isApplicable = applicableOffers.some(
        (o) => o.offer_id === parsedOfferId,
      );

      if (!isApplicable) {
        return badRequest(res, "Offer not applicable to cart items");
      }
    }

    // Apply offer to cart

    await applyOfferToCart(cartId, parsedOfferId);

    // Get updated cart with offer details

    const updatedCartData = await getCartWithOffer(cartId);

    const updatedCart = {
      ...updatedCartData[0],
      mappings: updatedCartData
        .filter((row) => row.product_id || row.category_id)
        .map((row) => ({
          product_id: row.product_id,
          category_id: row.category_id,
        })),
    };

    const updatedItems = await getCartItemsWithOffer(cartId);

    const cartOfferObj = updatedCart.offer_id
      ? {
          offer_id: updatedCart.offer_id,

          offer_name: updatedCart.offer_name,

          offer_type: updatedCart.offer_type,

          discount_type: updatedCart.discount_type,

          discount_value: updatedCart.discount_value,

          maximum_discount_amount: updatedCart.maximum_discount_amount,

          min_purchase_amount: updatedCart.min_purchase_amount,

          usage_limit_per_user: updatedCart.usage_limit_per_user,
          mappings: updatedCart.mappings,
        }
      : null;

    const response = await buildCartResponse(
      cartId,
      updatedItems,
      cartOfferObj,
    );

    return ok(res, "Offer applied to cart successfully", response);
  } catch (err) {
    console.error("Error in applyCartOffer:", err);

    return serverError(res, "Internal server error");
  }
}

/**

 * Remove offer from cart

 * DELETE /api/cart/offer

 * Headers: Authorization: Bearer <token>

 */

async function removeCartOffer(req, res) {
  try {
    const cartId = req.cart.cart_id;

    await removeOfferFromCart(cartId);

    const items = await getCartItemsWithOffer(cartId);

    const response = await buildCartResponse(cartId, items);

    return ok(res, "Offer removed from cart successfully", response);
  } catch (err) {
    console.error("Error in removeCartOffer:", err);

    return serverError(res, "Internal server error");
  }
}

/**

 * Apply offer to cart item (product-level offer)

 * POST /api/cart/items/:cartItemId/offer

 * Headers: Authorization: Bearer <token>

 * Body: { offer_id }

 */

async function applyCartItemOffer(req, res) {
  try {
    const cartItemId = req.cartItem.cart_item_id;

    const { offer_id, offerId } = req.body;

    const offerIdFinal = offer_id || offerId;

    if (!offerIdFinal) {
      return badRequest(res, "offer_id is required");
    }

    const parsedOfferId = parsePositiveInt(offerIdFinal);

    if (!parsedOfferId) {
      return badRequest(res, "Invalid offer_id");
    }

    // Get offer details to validate
    const [offerDetails] = await pool.query(
      `SELECT * FROM offer_master WHERE offer_id = ? AND is_active = 1 AND is_deleted = 0`,
      [parsedOfferId],
    );

    if (!offerDetails.length) {
      return badRequest(res, "Offer not found or not active");
    }

    const offer = offerDetails[0];

    // Check if offer is within valid date/time range
    const now = new Date();
    const startDate = new Date(offer.start_date);
    const endDate = new Date(offer.end_date);

    if (now < startDate || now > endDate) {
      return badRequest(res, "Offer is not currently valid");
    }

    // Check time-based offer
    if (offer.start_time && offer.end_time) {
      const currentTime = now.toTimeString().slice(0, 5);
      if (currentTime < offer.start_time || currentTime > offer.end_time) {
        return badRequest(res, "Offer is not valid at this time");
      }
    }

    // Check if offer is applicable to this cart item
    const cartItem = req.cartItem;
    if (
      offer.offer_type === "category_discount" ||
      offer.offer_type === "product_discount"
    ) {
      // Get applicable offers for this specific product
      const applicableOffers = await getApplicableOffersForProduct(
        cartItem.product_id,
      );
      const isApplicable = applicableOffers.some(
        (o) => o.offer_id === parsedOfferId,
      );

      if (!isApplicable) {
        return badRequest(res, "Offer not applicable to this product");
      }
    }

    // Apply offer to cart item

    await applyOfferToCartItem(cartItemId, parsedOfferId);

    const items = await getCartItemsWithOffer(req.cart.cart_id);

    const response = await buildCartResponse(req.cart.cart_id, items);

    return ok(res, "Offer applied to cart item successfully", response);
  } catch (err) {
    console.error("Error in applyCartItemOffer:", err);

    return serverError(res, "Internal server error");
  }
}

/**

 * Remove offer from cart item

 * DELETE /api/cart/items/:cartItemId/offer

 * Headers: Authorization: Bearer <token>

 */

async function removeCartItemOffer(req, res) {
  try {
    const cartItemId = req.cartItem.cart_item_id;

    await removeOfferFromCartItem(cartItemId);

    const items = await getCartItemsWithOffer(req.cart.cart_id);

    const response = await buildCartResponse(req.cart.cart_id, items);

    return ok(res, "Offer removed from cart item successfully", response);
  } catch (err) {
    console.error("Error in removeCartItemOffer:", err);

    return serverError(res, "Internal server error");
  }
}

// Get all ancestor category IDs for a category
const getCategoryAncestors = async (categoryId) => {
  if (!categoryId) return [];
  const [rows] = await pool.query(
    `WITH RECURSIVE cat_tree AS (
        SELECT category_id, parent_id
        FROM category_master
        WHERE category_id = ?
        UNION ALL
        SELECT c.category_id, c.parent_id
        FROM category_master c
        JOIN cat_tree ct ON c.category_id = ct.parent_id
    )
    SELECT category_id FROM cat_tree`,
    [categoryId],
  );
  return rows.map((r) => r.category_id);
};

/**

 * Get applicable offers for current cart

 * GET /api/cart/offers

 * Headers: Authorization: Bearer <token>

 */

async function getApplicableOffers(req, res) {
  try {
    const cartId = req.cart.cart_id;

    // Get cart items to find products

    const items = await getCartItemsWithOffer(cartId);
    console.log(`[DEBUG] Found ${items.length} items in cart ${cartId}`);

    // Get all applicable category IDs for each item (including ancestors)
    const itemsWithAncestors = await Promise.all(
      items.map(async (item) => {
        const ancestors = await getCategoryAncestors(item.category_id);
        console.log(
          `[DEBUG] Item ${item.product_id} category ${item.category_id} ancestors:`,
          ancestors,
        );
        return {
          ...item,
          categoryIds: ancestors,
        };
      }),
    );

    // Get applicable cart-level offers
    const cartOffersRaw = await getApplicableCartOffers();
    console.log(
      `[DEBUG] getApplicableCartOffers returned ${cartOffersRaw.length} raw offers`,
    );

    // Group items by offer_id to handle multiple mappings and deduplicate
    const groupedOffers = cartOffersRaw.reduce((acc, current) => {
      const id = current.offer_id;
      if (!acc[id]) {
        acc[id] = { ...current, mappings: [] };
      }
      if (current.product_id || current.category_id) {
        acc[id].mappings.push({
          product_id: current.product_id,
          category_id: current.category_id,
        });
      }
      return acc;
    }, {});

    const filteredCartOffers = Object.values(groupedOffers).filter((offer) => {
      if (
        offer.offer_type === "flat_discount" ||
        offer.offer_type === "first_order" ||
        offer.offer_type === "time_based"
      ) {
        return true;
      }
      // For category/product, check if any item in cart matches any of the mappings
      return itemsWithAncestors.some((item) =>
        offer.mappings.some(
          (m) =>
            (offer.offer_type === "product_discount" &&
              item.product_id === m.product_id) ||
            (offer.offer_type === "category_discount" &&
              item.categoryIds.includes(m.category_id)),
        ),
      );
    });

    const cartOffers = filteredCartOffers
      .filter(
        (o) =>
          o.offer_type === "flat_discount" ||
          o.offer_type === "first_order" ||
          o.offer_type === "time_based" ||
          o.offer_type === "category_discount",
      )
      .map((offer) => ({
        ...offer,
        type: "cart",
      }));

    const productOffers = filteredCartOffers
      .filter((o) => o.offer_type === "product_discount")
      .map((offer) => {
        // For productOffers, the frontend expects a single product_id/category_id in the root
        // to display "on [Product Name]". We'll pick the first mapping.
        const firstMapping = offer.mappings.find((m) => m.product_id) || {};
        return {
          ...offer,
          type: "product",
          product_id: firstMapping.product_id,
          category_id: firstMapping.category_id,
        };
      });

    return ok(res, "Applicable offers fetched successfully", {
      cartOffers,

      productOffers,
    });
  } catch (err) {
    console.error("Error in getApplicableOffers:", err);

    return serverError(res, "Internal server error");
  }
}

async function clearCart(req, res) {
  try {
    const userId = req.user.id;
    const cartId = req.cart.cart_id;

    await clearCartItems(cartId, userId);
    await removeOfferFromCart(cartId, userId);

    const response = await buildCartResponse(cartId, []);

    return ok(res, "Cart cleared", response);
  } catch (err) {
    console.error("Error in clearCart:", err);

    return serverError(res, "Internal server error");
  }
}

export {
  getCart,
  addItemToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  applyCartOffer,
  removeCartOffer,
  applyCartItemOffer,
  removeCartItemOffer,
  getApplicableOffers,
};
