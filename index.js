const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

dotenv.config();
const stripe = Stripe(
  process.env.PAYMENT_GATEWAY_SECRET_KEY
);
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

    const issuesCollection = db.collection('issues');



    // VERIFY JWT
    const verifyJWT = (req, res, next) => {

      const authorization = req.headers.authorization;

      if (!authorization) {

        return res.status(401).send({
          message: 'unauthorized access'
        });
      }

      const token = authorization.split(' ')[1];

      jwt.verify(
        token,
        process.env.ACCESS_TOKEN_SECRET,

        (err, decoded) => {

          if (err) {

            return res.status(401).send({
              message: 'unauthorized access'
            });
          }

          req.decoded = decoded;

          next();
        }
      );
    };



    // VERIFY ADMIN
    const verifyAdmin = async (req, res, next) => {

      const email = req.decoded.email;

      const query = {
        email
      };

      const user = await usersCollection.findOne(query);

      if (user.role !== 'admin') {

        return res.status(403).send({
          message: 'forbidden access'
        });
      }

      next();
    };


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

    app.patch('/users/premium/:email', async (req, res) => {

      const email = req.params.email;
    
      const filter = {
        email
      };
    
      const updatedDoc = {
    
        $set: {
          premium: true
        }
      };
    
      const result = await usersCollection.updateOne(
        filter,
        updatedDoc
      );
    
      res.send(result);
    });

    app.post('/issues', async (req, res) => {

      const issueData = req.body;
    
      const result = await issuesCollection.insertOne({
        ...issueData,
        status: 'pending',
        priority: 'normal',
        upvotes: 0,
        upvotedUsers: [],
        assignedStaff: null,
        createdAt: new Date()
      });
    
      res.send(result);
    });
    app.patch('/issues/upvote/:id', verifyJWT, async (req, res) => {

      const id = req.params.id;
    
      const email = req.decoded.email;
    
      const query = {
        _id: new ObjectId(id)
      };
    
    
    
      const issue =
        await issuesCollection.findOne(query);
    
    
    
      // OWN ISSUE CHECK
      if (issue.userEmail === email) {
    
        return res.status(403).send({
          message: 'You cannot upvote your own issue'
        });
      }
    
    
    
      // DUPLICATE CHECK
      if (issue.upvotedUsers.includes(email)) {
    
        return res.status(403).send({
          message: 'Already upvoted'
        });
      }
    
    
    
      const updateDoc = {
    
        $inc: {
          upvotes: 1
        },
    
        $push: {
          upvotedUsers: email
        }
      };
    
    
    
      const result =
        await issuesCollection.updateOne(
          query,
          updateDoc
        );
    
    
    
      res.send(result);
    
    });
    app.get('/my-issues/:email', async (req, res) => {

      const email = req.params.email;
    
      const query = {
        userEmail: email
      };
    
      const result = await issuesCollection
        .find(query)
        .toArray();
    
      res.send(result);
    });
    app.get('/issues', async (req, res) => {

      const search = req.query.search || '';
    
      const category = req.query.category || '';
    
      const status = req.query.status || '';
    
      const priority = req.query.priority || '';
    
      const sort = req.query.sort || '';
    
      const page = parseInt(req.query.page) || 0;
    
      const size = parseInt(req.query.size) || 6;
      
      const query = {};
    
      // SEARCH
      if (search) {
    
        query.$or = [
    
          {
            title: {
              $regex: search,
              $options: 'i'
            }
          },
    
          {
            category: {
              $regex: search,
              $options: 'i'
            }
          },
    
          {
            location: {
              $regex: search,
              $options: 'i'
            }
          }
    
        ];
      }
    
    
    
      // CATEGORY FILTER
      if (category) {
    
        query.category = category;
      }
    
    
    
      // STATUS FILTER
      if (status) {
    
        query.status = status;
      }
    
    
    
      // PRIORITY FILTER
      if (priority) {
    
        query.priority = priority;
      }
    
    
    
      // SORTING
      let sortOption = {};
    
      if (sort === 'newest') {
    
        sortOption = {
          createdAt: -1
        };
      }
    
    
    
      if (sort === 'upvotes') {
    
        sortOption = {
          upvotes: -1
        };
      }
    
    
    
      // TOTAL COUNT
      const total =
        await issuesCollection.countDocuments(query);
    
      // DATA
      const result = await issuesCollection
    
        .find(query)
    
        .sort(sortOption)
    
        .skip(page * size)
    
        .limit(size)
    
        .toArray();
      res.send({
    
        issues: result,
        total
      });
    
    });
    app.get('/issues/:id', async (req, res) => {

      const id = req.params.id;
    
      const query = {
        _id: new ObjectId(id)
      };
    
      const result = await issuesCollection.findOne(query);
    
      res.send(result);
    });
    app.patch('/issues/upvote/:id', async (req, res) => {

      const id = req.params.id;
    
      const email = req.body.email;
    
      const issue = await issuesCollection.findOne({
        _id: new ObjectId(id)
      });
    
      if (
        issue.upvotedUsers &&
        issue.upvotedUsers.includes(email)
      ) {
    
        return res.send({
          message: 'already upvoted'
        });
      }
    
      const result = await issuesCollection.updateOne(
    
        {
          _id: new ObjectId(id)
        },
    
        {
          $inc: {
            upvotes: 1
          },
    
          $set: {
            priority: 'high'
          },
    
          $push: {
            upvotedUsers: email
          }
        }
      );
    
      res.send(result);
    });
    app.get(
      '/admin/issues',
      verifyJWT,
      verifyAdmin, async (req, res) => {

      const result = await issuesCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
    
      res.send(result);
    });
    app.get(
      '/admin/statistics',
      verifyJWT,
      verifyAdmin,
    
      async (req, res) => {
    
        const totalUsers =
          await usersCollection.countDocuments();
    
        const totalIssues =
          await issuesCollection.countDocuments();
    
        const resolvedIssues =
          await issuesCollection.countDocuments({
            status: 'resolved'
          });
    
        const pendingIssues =
          await issuesCollection.countDocuments({
            status: 'pending'
          });
    
        const premiumUsers =
          await usersCollection.countDocuments({
            premium: true
          });
    
        res.send({
    
          totalUsers,
          totalIssues,
          resolvedIssues,
          pendingIssues,
          premiumUsers
        });
    });
    app.patch(
      '/issues/status/:id',
      verifyJWT,
      verifyAdmin, async (req, res) => {

      const id = req.params.id;
    
      const { status } = req.body;
    
      const filter = {
        _id: new ObjectId(id)
      };
    
      const updatedDoc = {
    
        $set: {
          status
        }
      };
    
      const result = await issuesCollection.updateOne(
        filter,
        updatedDoc
      );
    
      res.send(result);
    });
    app.get('/latest-resolved-issues', async (req, res) => {

      const result = await issuesCollection
        .find({ status: 'resolved' })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
    
      res.send(result);
    });
    // Get user by email
    app.get(
      '/users/:email',
      verifyJWT,
    
      async (req, res) => {
    
        const email = req.params.email;
    
        if (email !== req.decoded.email) {
    
          return res.status(403).send({
            message: 'forbidden access'
          });
        }
    
        const query = { email };
    
        const user = await usersCollection.findOne(query);
    
        res.send(user);
    });

    app.get(
      '/users',
      verifyJWT,
      verifyAdmin,
    
      async (req, res) => {
    
        const result = await usersCollection
          .find()
          .toArray();
    
        res.send(result);
    });

    app.patch(
      '/users/admin/:id',
      verifyJWT,
      verifyAdmin, async (req, res) => {

      const id = req.params.id;
    
      const filter = {
        _id: new ObjectId(id)
      };
    
      const updatedDoc = {
    
        $set: {
          role: 'admin'
        }
      };
    
      const result = await usersCollection.updateOne(
        filter,
        updatedDoc
      );
    
      res.send(result);
    });
    app.patch(
      '/users/block/:id',
      verifyJWT,
      verifyAdmin, async (req, res) => {

      const id = req.params.id;
    
      const filter = {
        _id: new ObjectId(id)
      };
    
      const updatedDoc = {
    
        $set: {
          blocked: true
        }
      };
    
      const result = await usersCollection.updateOne(
        filter,
        updatedDoc
      );
    
      res.send(result);
    });
    app.delete(
      '/users/:id',
      verifyJWT,
      verifyAdmin, async (req, res) => {

      const id = req.params.id;
    
      const query = {
        _id: new ObjectId(id)
      };
    
      const result = await usersCollection.deleteOne(query);
    
      res.send(result);
    });

    app.post('/create-payment-intent', async (req, res) => {

      const { amount } = req.body;
    
      const totalAmount = parseInt(amount * 100);
    
      const paymentIntent = await stripe.paymentIntents.create({
    
        amount: totalAmount,
    
        currency: 'usd',
    
        payment_method_types: ['card']
      });
    
      res.send({
    
        clientSecret: paymentIntent.client_secret
      });
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