const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.o7z4zqh.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {

  try {

    const db = client.db('publicInfrastructureDB');

    const usersCollection = db.collection('users');

    // JWT API
    app.post('/jwt', async (req, res) => {

      const user = req.body;

      const token = jwt.sign(
        user,
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: '7d' }
      );

      res.send({ token });
    });

    // Save User
    app.post('/users', async (req, res) => {

      const userData = req.body;

      const existingUser = await usersCollection.findOne({
        email: userData.email
      });

      if (existingUser) {
        return res.send({ message: 'user already exists' });
      }

      const result = await usersCollection.insertOne({
        ...userData,
        role: 'citizen',
        premium: false,
        blocked: false,
        createdAt: new Date()
      });

      res.send(result);
    });

    // Get user by email
    app.get('/users/:email', async (req, res) => {

      const email = req.params.email;

      const result = await usersCollection.findOne({ email });

      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });

    console.log("MongoDB Connected Successfully");

  } finally {
  }
}

run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Server is running');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});