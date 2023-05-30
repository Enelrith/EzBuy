const express = require("express");
const mysql = require("mysql");
const path = require("path");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
dotenv.config({ path: "./config.env" });
const app = express();
const session = require("express-session");
const { exitCode, exit } = require("process");
const crypto = require("crypto");
const MySQLStore = require("express-mysql-session")(session);
const sessionStore = new MySQLStore({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_ROOT,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE,
  port: process.env.DATABASE_PORT,
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 86400000,
});
const db = mysql.createConnection({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_ROOT,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE,
  port: process.env.DATABASE_PORT,
});

const publicDir = path.join(__dirname, "./public");

app.use(express.static(publicDir));
app.use(express.urlencoded({ extended: "false" }));
app.use(express.json());

app.set("view engine", "hbs");

db.connect((error) => {
  if (error) {
    console.log(error);
  } else {
    console.log("MySQL connected!");
  }
});
const generateSecret = () => {
  return crypto.randomBytes(32).toString("hex");
};
const sessionSecret = generateSecret();
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
    },
  })
);
app.get("/", (req, res) => {
  if (!req.session.user) {
    res.render("login");
  } else {
    res.render("index", { username: req.session.username });
    console.log(req.session.username);
    console.log(req.sessionID);
  }
});
app.get("/register", (req, res) => {
  res.render("register");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.get("/store", (req, res) => {
  if (!req.session.user) {
    res.render("login");
  } else {
    db.query("SELECT * FROM products", (error, result) => {
      if (error) {
        console.log(error);
        res.render("error"); // Render an error page
      } else {
        res.render("store", { products: result }); // Render the "store" page and pass the product data
      }
    });
  }
});

app.get("/store/:id", (req, res) => {
  const productId = req.params.id;
  db.query(
    "SELECT * FROM products WHERE id = ?",
    [productId],
    function (error, result) {
      if (error) {
        console.log(error);
        res.render("error");
      } else {
        res.render("product", { product: productId, result });
      }
    }
  );
});
app.get("/checkout", (req, res) => {
  if (!req.session.user) {
    res.render("login");
  } else {
    const username = req.session.username;
    db.query(
      "SELECT * FROM cart WHERE username = ?",
      [username],
      (error, result) => {
        if (error) {
          console.log(error);
        } else {
          res.render("checkout", { checkout: result });
        }
      }
    );
  }
});

app.post("/auth/checkout", (req, res) => {
  const username = req.session.username;

  function generateRandomOrderId() {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let orderid = "";
    for (let i = 0; i < 8; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      orderid += characters.charAt(randomIndex);
    }
    return orderid;
  }

  function generateRandomShippingDate() {
    const today = new Date();
    const numberOfDaysToAdd = Math.floor(Math.random() * 7) + 1; // Random number between 1 and 7
    const shippingDate = new Date(
      today.getTime() + numberOfDaysToAdd * 24 * 60 * 60 * 1000
    );
    const year = shippingDate.getFullYear();
    const month = String(shippingDate.getMonth() + 1).padStart(2, "0");
    const day = String(shippingDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  const orderid = generateRandomOrderId();
  const shippingDate = generateRandomShippingDate();

  console.log("Order ID:", orderid);
  console.log("Shipping Date:", shippingDate);

  db.query(
    "SELECT name FROM cart WHERE username = ?",
    [username],
    (error, products) => {
      if (error) {
        console.log(error);
      } else {
        db.query(
          "INSERT INTO orders (orderid, username, products, date) VALUES (?,?,?,?)",
          [orderid, username, JSON.stringify(products), shippingDate],
          (error, result) => {
            if (error) {
              console.log(error);
            } else {
              res.render("orders", {
                username: username,
                orderid: orderid,
                date: shippingDate,
              });
            }
          }
        );
      }
    }
  );
});

app.post("/cart", (req, res) => {
  if (!req.session.user) {
    res.render("login");
  } else {
    const username = req.session.username;
    const productID = req.body.id;
    const productName = req.body.name;
    const price = req.body.price;
    const startingQuantity = 1;

    db.query(
      "SELECT * FROM cart WHERE username = ? AND id = ?",
      [username, productID],
      (error, result) => {
        if (error) {
          console.log(error);
          res
            .status(500)
            .json({ error: "Failed to add the product to the cart" });
          return;
        }

        if (result.length > 0) {
          const updatedQuantity = result[0].quantity + 1;
          const updatedPrice = result[0].price * updatedQuantity;
          db.query(
            "UPDATE cart SET quantity = ?, displayPrice = ? WHERE username = ? AND id = ?",
            [updatedQuantity, updatedPrice, username, productID],
            (error) => {
              if (error) {
                console.log(error);
                res.status(500).json({
                  error: "Failed to update the product quantity in the cart",
                });
              } else {
                console.log("Product quantity updated in the cart");

                // Fetch the updated cart data
                db.query(
                  "SELECT * FROM cart WHERE username = ?",
                  [username],
                  (error, result) => {
                    if (error) {
                      console.log(error);
                      res.status(500).json({
                        error: "Failed to fetch the updated cart data",
                      });
                    } else {
                      // Calculate the total price
                      const totalPrice = result.reduce(
                        (sum, item) => sum + item.displayPrice,
                        0
                      );
                      console.log("Total price:", totalPrice);

                      // Update the totalPrice in the cart table
                      db.query(
                        "UPDATE cart SET totalPrice = ? WHERE username = ?",
                        [totalPrice, username],
                        (error) => {
                          if (error) {
                            console.log(error);
                            res.status(500).json({
                              error:
                                "Failed to update the total price in the cart",
                            });
                          } else {
                            console.log("Total price updated in the cart");
                            // Continue with your response and further logic
                          }
                        }
                      );
                    }
                  }
                );
              }
            }
          );
        } else {
          db.query(
            "INSERT INTO cart (username, id, name, price, quantity, displayPrice) VALUES (?,?,?,?,?,?)",
            [username, productID, productName, price, startingQuantity, price],
            (error) => {
              if (error) {
                console.log(error.sql);
                console.log(error);
                res
                  .status(500)
                  .json({ error: "Failed to add the product to the cart" });
              } else {
                console.log("Product added to cart");
                // Fetch the updated cart data
                db.query(
                  "SELECT * FROM cart WHERE username = ?",
                  [username],
                  (error, result) => {
                    if (error) {
                      console.log(error);
                      res.status(500).json({
                        error: "Failed to fetch the updated cart data",
                      });
                    } else {
                      // Calculate the total price
                      const totalPrice = result.reduce(
                        (sum, item) => sum + item.displayPrice,
                        0
                      );
                      console.log("Total price:", totalPrice);

                      // Update the totalPrice in the cart table
                      db.query(
                        "UPDATE cart SET totalPrice = ? WHERE username = ?",
                        [totalPrice, username],
                        (error) => {
                          if (error) {
                            console.log(error);
                            res.status(500).json({
                              error:
                                "Failed to update the total price in the cart",
                            });
                          } else {
                            console.log("Total price updated in the cart");
                            // Continue with your response and further logic
                          }
                        }
                      );
                    }
                  }
                );
              }
            }
          );
        }
      }
    );
  }
});

app.get("/cart", (req, res) => {
  if (!req.session.user) {
    res.render("login");
  } else {
    const username = req.session.username;

    db.query(
      "SELECT * FROM cart WHERE username = ?",
      [username],
      (error, result) => {
        if (error) {
          console.log(error);
        } else {
          res.render("cart", { cart: result }); // Pass the cart data to the cart view
        }
      }
    );
  }
});
app.post("/removeqt", (req, res) => {
  const id = req.body.id;
  const username = req.session.username;
  db.query(
    "SELECT * FROM cart WHERE id = ? AND username = ?",
    [id, username],
    (error, result) => {
      if (error) {
        console.log(error);
      } else {
        const quantity = result[0].quantity;
        const price = result[0].price;
        const displayPrice = price * (quantity - 1);

        db.query(
          "UPDATE cart SET quantity = ?, displayPrice = ? WHERE id = ? AND username = ?",
          [quantity - 1, displayPrice, id, username],
          (error) => {
            if (error) {
              console.log(error);
              res.status(500).json({
                error: "Failed to update the product quantity in the cart",
              });
            } else {
              console.log("Product quantity updated in the cart");
              db.query("DELETE FROM cart WHERE quantity = 0", (error) => {
                if (error) {
                  console.log(error);
                } else {
                  console.log("Deleted");

                  // Fetch the updated cart data
                  db.query(
                    "SELECT * FROM cart WHERE username = ?",
                    [username],
                    (error, result) => {
                      if (error) {
                        console.log(error);
                        res.status(500).json({
                          error: "Failed to fetch the updated cart data",
                        });
                      } else {
                        // Calculate the total price
                        const totalPrice = result.reduce(
                          (sum, item) => sum + item.displayPrice,
                          0
                        );
                        console.log("Total price:", totalPrice);

                        // Update the totalPrice in the cart table
                        db.query(
                          "UPDATE cart SET totalPrice = ? WHERE username = ?",
                          [totalPrice, username],
                          (error) => {
                            if (error) {
                              console.log(error);
                              res.status(500).json({
                                error:
                                  "Failed to update the total price in the cart",
                              });
                            } else {
                              console.log("Total price updated in the cart");
                              res.redirect("cart");
                            }
                          }
                        );
                      }
                    }
                  );
                }
              });
            }
          }
        );
      }
    }
  );
});

app.post("/increaseqt", (req, res) => {
  const username = req.session.username;
  const id = req.body.id;
  db.query(
    "SELECT * FROM cart WHERE id = ? AND username = ?",
    [id, username],
    (error, result) => {
      if (error) {
        console.log(error);
      } else {
        const quantity = parseInt(result[0].quantity);
        const price = parseFloat(result[0].price);
        const displayPrice = price * (quantity + 1);

        db.query(
          "UPDATE cart SET quantity = ?, displayPrice = ? WHERE id = ? AND username = ?",
          [quantity + 1, displayPrice, id, username],
          (error) => {
            if (error) {
              console.log(error);
              res.status(500).json({
                error: "Failed to update the product quantity in the cart",
              });
            } else {
              console.log("Product quantity updated in the cart");

              // Fetch the updated cart data
              db.query(
                "SELECT * FROM cart WHERE username = ?",
                [username],
                (error, result) => {
                  if (error) {
                    console.log(error);
                    res.status(500).json({
                      error: "Failed to fetch the updated cart data",
                    });
                  } else {
                    // Calculate the total price
                    const totalPrice = result.reduce(
                      (sum, item) => sum + item.displayPrice,
                      0
                    );
                    console.log("Total price:", totalPrice);

                    // Update the totalPrice in the cart table
                    db.query(
                      "UPDATE cart SET totalPrice = ? WHERE username = ?",
                      [totalPrice, username],
                      (error) => {
                        if (error) {
                          console.log(error);
                          res.status(500).json({
                            error:
                              "Failed to update the total price in the cart",
                          });
                        } else {
                          console.log("Total price updated in the cart");
                          res.redirect("cart");
                        }
                      }
                    );
                  }
                }
              );
            }
          }
        );
      }
    }
  );
});

app.post("/search", (req, res) => {
  const { search } = req.body;
  db.query(
    "SELECT * FROM products WHERE name LIKE ?",
    [`%${search}%`],
    (error, result) => {
      if (error) {
        console.log(error);
        return res
          .status(500)
          .send("An error occurred while querying the database");
      }
      if (result.length > 0) {
        console.log(result);
        return res.render("search", { product: search, result });
      } else {
        return res.render("search", { product: search, result: [] });
      }
    }
  );
});

app.get("/categories", (req, res) => {
  if (!req.session.user) {
    res.render("login");
  } else {
    db.query(
      "SELECT type FROM types WHERE type IS NOT NULL",
      (error, result) => {
        if (error) {
          console.log(error);
        } else {
          res.render("categories", { type: result });
        }
      }
    );
  }
});

app.get("/categories/:name", (req, res) => {
  const type = req.params.name;
  console.log(type);
  db.query("SELECT * FROM products WHERE type=?", [type], (error, result) => {
    if (error) {
      console.log(error);
      return res
        .status(500)
        .send("An error occurred while querying the database");
    } else {
      return res.render("categories/filterview", { type: result });
    }
  });
});

app.post("/auth/register", (req, res) => {
  const { name, email, password, password_confirm } = req.body;

  db.query(
    "SELECT email FROM users WHERE email = ?",
    [email],
    async (error, result) => {
      if (error) {
        console.log(error);
      }

      if (result.length > 0) {
        return res.render("register", {
          message: "This email is already in use",
        });
      } else if (password !== password_confirm) {
        return res.render("register", {
          message: "Password Didn't Match!",
        });
      }

      let hashedPassword = await bcrypt.hash(password, 8);

      console.log(hashedPassword);

      db.query(
        "INSERT INTO users SET?",
        { username: name, email: email, password: hashedPassword },
        (error, result) => {
          if (error) {
            console.log(error);
          } else {
            return res.render("register", {
              message: "User registered!",
            });
          }
        }
      );
    }
  );
});

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user;
  next();
});
app.post("/auth/login", (req, res) => {
  const { name, password } = req.body;
  db.query(
    "SELECT * FROM users WHERE username = ?",
    [name],
    async (error, results) => {
      if (error) {
        console.log(error);
      }

      if (results.length == 0) {
        return res.render("login", {
          message: "Invalid username or password",
        });
      }

      const user = results[0];
      const isPasswordMatched = await bcrypt.compare(password, user.password);

      if (isPasswordMatched) {
        const sessionID = req.sessionID;
        const userID = user.userid;

        db.query(
          "UPDATE users SET sessionid = ? WHERE userid = ?",
          [sessionID, userID],
          (error) => {
            if (error) {
              console.log(error);
            } else {
              req.session.user = user;
              req.session.username = name;
              console.log(userID);
              console.log(sessionID);
              return res.redirect("/");
            }
          }
        );
      } else {
        return res.render("login", {
          message: "Invalid username or password",
        });
      }
    }
  );
});
app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});
app.listen(5000, () => {
  console.log("server started on port 5000");
});
