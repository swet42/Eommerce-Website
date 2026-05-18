# ShopSphere E-Commerce Platform

A comprehensive full-stack e-commerce solution featuring a robust Node.js/Express backend and a modern React/Redux frontend. This platform handles everything from product catalogs and cart management to secure payments with Stripe and administrative controls.

## 🚀 Features

### Frontend (User Experience)

- **Modern UI:** Built with React, Tailwind CSS, and PrimeReact for a sleek, responsive design.
- **State Management:** Powered by Redux Toolkit for seamless cart and user data handling.
- **Product Discovery:** Category-based browsing, advanced filtering, and search functionality.
- **Cart System:** Supports product portions, modifiers (e.g., "Extra Cheese"), and real-time total calculations.
- **Secure Checkout:** Integrated with Stripe for reliable payment processing.
- **User Profiles:** Address management, order history, and account settings.

### Backend (Robust API)

- **Modular Architecture:** Cleanly organized into Controllers, Models, Routes, and Middlewares.
- **Security:** JWT-based authentication, password hashing with bcrypt, and secure HTTP headers via Helmet.
- **Image Management:** Integrated with Cloudinary for optimized image storage.
- **Database:** MySQL relational database for structured data management.
- **Analytics:** Built-in tracking for sales and user engagement.

---

## 🛠 Tech Stack

| Domain       | Technology                                                          |
| :----------- | :------------------------------------------------------------------ |
| **Frontend** | React, Redux Toolkit, React Router, Axios, Tailwind CSS, PrimeReact |
| **Backend**  | Node.js, Express.js, MySQL (mysql2), JWT, Multer, Zod               |
| **Services** | Stripe (Payments), Cloudinary (Images), Nodemailer (Emails)         |
| **Tools**    | Vite, PostCSS, Git                                                  |

---

## 📂 Project Structure

```text
├── BACKEND/             # Express API Server
│   ├── configs/         # Database and Cloudinary configurations
│   ├── controllers/     # Business logic handlers
│   ├── models/          # MySQL database schemas/models
│   ├── routes/          # API endpoint definitions
│   ├── migrations/      # SQL schema updates
│   └── seeders/         # Initial data scripts
├── FRONTEND/            # React/Tailwind Client
│   ├── src/
│   │   ├── api/         # Service layer for API calls
│   │   ├── components/  # Reusable UI components
│   │   ├── redux/       # Global state management
│   │   └── pages/       # View components
└── package.json         # Workspace configuration
```

---

## 🚦 Getting Started

### Prerequisites

- Node.js (v18+)
- MySQL Server
- Cloudinary Account (for image uploads)
- Stripe Account (for payments)

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd BACKEND
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file based on the environment requirements (see `configs/env.js`):
   ```env
   PORT=5000
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=ecommerce
   JWT_SECRET=your_jwt_secret
   CLOUDINARY_CLOUD_NAME=...
   STRIPE_SECRET_KEY=...
   ```
4. Initialize the database:
   ```bash
   "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p ecommerce < db_schema.sql
   ```
5. Run the server:
   ```bash
   npm run dev
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd FRONTEND
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```

---

## 📖 API Documentation

Detailed integration guides for specific systems can be found here:

- [Cart System Architecture](BACKEND/README_CART.md)
- [API Integration Guide (Cart/Orders/Offers)](BACKEND/README_CART_ORDER_INTEGRATION.md)

---

## 🤝 Contributing

1. Fork the project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the ISC License. See `package.json` for more information.
