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
const admin = require("firebase-admin");
const port = process.env.PORT || 5000;
const serviceAccount = require("./firbase-admin-config.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

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
    
    const staffCollection = db.collection('staff'); 
    const paymentsCollection = db.collection('payments');

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

      if (!user || user.role !== 'admin') {

        return res.status(403).send({
          message: 'forbidden access'
        });
      }

      next();
    };
    const verifyStaff = async (req, res, next) => {
      const email = req.decoded.email;
    
      const user = await usersCollection.findOne({ email });
    
      if (!user || user.role !== 'staff') {
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
        email: userData.email.toLowerCase(),
      });

      if (existingUser) {
        return res.send({ message: 'user already exists' });
      }

      const result = await usersCollection.insertOne({
        ...userData,
        role: 'citizen',
        name: userData.name,
        photo: userData.photo,
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
        timeline: [
          {
            status: 'pending',
            message: 'Issue reported by citizen',
            updatedBy: issueData.userName,
            time: new Date()
          }
        ],
        assignedStaff: null,
        createdAt: new Date()
      });
    
      res.send(result);
    });

    // ==========================================
    // FIXED: ADDED THE MISSING ISSUE ASSIGNMENT ROUTE HERE
    // ==========================================
    app.patch('/issues/assign/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const { status, assignedStaff } = req.body;
      const filter = { _id: new ObjectId(id) };
      
      const updateDoc = {
        $set: {
          status: status || 'pending',
          assignedStaff: {
            id: assignedStaff.id,
            name: assignedStaff.name,
            email: assignedStaff.email
          }
        },
        $push: {
          timeline: {
            status: 'pending',
            message: `Issue assigned to Staff: ${assignedStaff.name}`,
            updatedBy: req.decoded.email,
            time: new Date()
          }
        }
      };

      const result = await issuesCollection.updateOne(filter, updateDoc);
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
          timeline: {
            status: 'upvote',
            upvotedUsers: email,
            message: 'Issue received an upvote',
            updatedBy: email,
            time: new Date()
          }
        }
        
      };
    
      const result =
        await issuesCollection.updateOne(
          query,
          updateDoc
        );
    
      res.send(result);
    
    });
    app.patch(
      '/issues/reject/:id',
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
    
        const id = req.params.id;
    
        const result =
          await issuesCollection.updateOne(
    
            {
              _id: new ObjectId(id)
            },
    
            {
              $set: {
                status: 'rejected'
              },
    
              $push: {
                timeline: {
                  status: 'rejected',
                  message: 'Issue rejected by admin',
                  updatedBy: 'Admin',
                  time: new Date()
                }
              }
            }
          );
    
        res.send(result);
    });
    app.delete('/issues/:id', verifyJWT, async (req, res) => {

      const id = req.params.id;
    
      const query = {
        _id: new ObjectId(id)
      };
    
      const result =
        await issuesCollection.deleteOne(query);
    
      res.send(result);
    
    });
    app.patch('/issues/:id', verifyJWT, async (req, res) => {

      const id = req.params.id;
      const updatedData = req.body;
      const query = {
        _id: new ObjectId(id)
      };
    
      const updateDoc = {

        $set: {
      
          title: updatedData.title,
      
          description: updatedData.description,
      
          location: updatedData.location,
      
          category: updatedData.category,
      
          image: updatedData.image
      
        },
      
        $push: {
      
          timeline: {
      
            status: 'updated',
      
            message: 'Issue updated by citizen',
      
            updatedBy: updatedData.userName,
      
            time: new Date()
          }
        }
      };
    
      const result =
        await issuesCollection.updateOne(
          query,
          updateDoc
        );
    
      res.send(result);
    
    });
    app.patch('/issues/boost/:id', verifyJWT, async (req, res) => {

      const id = req.params.id;
    
      const query = {
        _id: new ObjectId(id)
      };
    
      const updateDoc = {
    
        $set: {
          priority: 'high'
        },
    
        $push: {
    
          timeline: {
    
            status: 'boosted',
    
            message: 'Issue priority boosted',
    
            updatedBy: req.decoded.email,
    
            time: new Date()
          }
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

      const email = req.params.email.toLowerCase();;
    
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
    app.get('/staff-stats/:email',

  verifyJWT,

  async (req, res) => {

    const email = req.params.email;

    const assigned =
      await issuesCollection.countDocuments({

        'assignedStaff.email': email
      });

    const resolved =
      await issuesCollection.countDocuments({

        'assignedStaff.email': email,

        status: 'resolved'
      });

    const today =
      await issuesCollection.countDocuments({

        'assignedStaff.email': email,

        status: {
          $ne: 'closed'
        }
      });

    res.send({

      assigned,
      resolved,
      today
    });

});
app.get('/assigned-issues/:email',

  verifyJWT,

  async (req, res) => {

    const email = req.params.email;

    const result =
      await issuesCollection

      .find({

        'assignedStaff.email': email
      })

      .sort({

        priority: -1
      })

      .toArray();

    res.send(result);

});

// FIXED: Cleaned up duplicate status route and verified admin safety protection
app.patch(
  '/issues/status/:id',
  verifyJWT,verifyStaff,
  async (req, res) => {

    const id = req.params.id;

    const { status } = req.body;
    let message = '';

if (status === 'in-progress') {
  message = 'Work started on the issue';
}

if (status === 'working') {
  message = 'Issue is currently being worked on';
}

if (status === 'resolved') {
  message = 'Issue marked as resolved';
}

if (status === 'closed') {
  message = 'Issue closed by staff';
}
    const result =
      await issuesCollection.updateOne(

        {
          _id: new ObjectId(id)
        },

        {
          $set: {
            status
          },

          $push: {
            timeline: {
              status,
              message,
              updatedBy: "Staff",
              time: new Date()
            }
          }
        }
      );

    res.send(result);
});
app.put('/users/profile/:email',

verifyJWT,

async (req, res) => {

  const email = req.params.email;

  const updatedData = req.body;

  const filter = {
    email
  };

  const updateDoc = {

    $set: {

      name: updatedData.name,

      photo: updatedData.photo
    }
  };

  const result =
    await usersCollection.updateOne(
      filter,
      updateDoc
    );

  res.send(result);

});
app.get(

  '/users/profile/:email',

  verifyJWT,

  async (req, res) => {

    const email = req.params.email;

    const query = {
      email
    };

    const user =
      await usersCollection.findOne(query);

    res.send(user);

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
    
        const rejectedIssues =
          await issuesCollection.countDocuments({
            status: 'rejected'
          });
    
        const premiumUsers =
          await usersCollection.countDocuments({
            premium: true
          });
    
        const latestIssues =
          await issuesCollection
            .find()
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();
    
        const latestUsers =
          await usersCollection
            .find({ role: 'citizen' })
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();
    
        const latestPayments =
          await paymentsCollection
            .find()
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray();
    
        const paymentData =
          await paymentsCollection.find().toArray();
    
        const totalPaymentsReceived =
          paymentData.reduce(
            (sum, payment) =>
              sum + Number(payment.amount || 0),
            0
          );
    
        res.send({
          totalUsers,
          totalIssues,
          resolvedIssues,
          pendingIssues,
          rejectedIssues,
          premiumUsers,
          totalPaymentsReceived,
          latestIssues,
          latestUsers,
          latestPayments
        });
      }
    );
    app.post('/payments', async (req, res) => {

      const payment = req.body;
      payment.createdAt = new Date();
      const result =
        await paymentsCollection.insertOne(payment);
    
      res.send(result);
    });
    app.post('/admin/staff/create', verifyJWT, verifyAdmin, async (req, res) => {
      const { name, email, phone, photo, password } = req.body;
      const normalizedEmail = email.toLowerCase();
      try {
        // 1. Create the user in Firebase Authentication via Admin SDK
        const firebaseUser = await admin.auth().createUser({
          email: normalizedEmail,
          password: password,
          displayName: name,
          photoURL: photo,
        });

        // 2. Set Custom Claims so Firebase knows this user is explicitly 'staff'
        await admin.auth().setCustomUserClaims(firebaseUser.uid, { role: 'staff' });

        // 3. Document payload layout for MongoDB
        const newStaffDoc = {
          uid: firebaseUser.uid, // Linking Firebase UID to Mongo Document
          name,
          email: normalizedEmail,
          phone,
          photo,
          role: 'staff',
          premium: false,
          blocked: false,
          createdAt: new Date()
        };
        await usersCollection.insertOne({
          uid: firebaseUser.uid,
          name,
          email: normalizedEmail,
          phone,
          photo,
          role: 'staff',
          premium: false,
          blocked: false,
          createdAt: new Date()
        });
        // 4. Save to MongoDB collection
        const result = await staffCollection.insertOne(newStaffDoc);
        
        res.status(201).send({ insertedId: result.insertedId });

      } catch (error) {
        console.error("Error provisioning staff member:", error);
        res.status(400).send({ 
          message: error.message || "Failed to create staff credentials." 
        });
      }
    });
    // GET all staff members directly from the staff collection
app.get('/admin/staff', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const result = await staffCollection.find().toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch staff data." });
  }
});

// PUT to update staff details
app.put('/admin/staff/:id', verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body;
  const filter = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: {
      name: updatedData.name,
      phone: updatedData.phone,
      photo: updatedData.photo
    }
  };
  const result = await staffCollection.updateOne(filter, updateDoc);
  res.send(result);
});

// DELETE a staff member
app.delete('/admin/staff/:id', verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await staffCollection.deleteOne(query);
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
    
        const email =  req.params.email.toLowerCase();;
    
        console.log("REQUEST EMAIL =", email);
        console.log("JWT EMAIL =", req.decoded.email);
    
        const query = { email };
    
        const user =
  await usersCollection.findOne({
    email
  });
    
        console.log("FOUND USER =", user);
    
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