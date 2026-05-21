import pool from "./configs/db.js";

async function checkOffers() {
  try {
    const [offers] = await pool.query("SELECT * FROM offer_master");
    console.log("--- Offer Master ---");
    console.table(offers);

    const [mappings] = await pool.query("SELECT * FROM offer_product_category");
    console.log("--- Offer Mappings ---");
    console.table(mappings);

    const [cartItems] = await pool.query(
      "SELECT * FROM cart_items WHERE is_deleted = 0",
    );
    console.log("--- Cart Items ---");
    console.table(cartItems);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkOffers();
