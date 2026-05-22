import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "./config/prisma.js";
import { authenticateToken, isAdmin} from "./middleware/auth.js";
import { Parser } from 'json2csv';



const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET;

// Middleware
app.use(cors({ origin: "*"}));
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Workspace Registry API running" });
});

// ============================================
// AUTH ROUTES
// ============================================

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // ✅ Read secret directly from environment
    const JWT_SECRET = process.env.JWT_SECRET;

    if (!JWT_SECRET) {
      return res.status(500).json({ error: "JWT_SECRET not configured" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Register new staff (admin only)
app.post("/api/auth/register", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields required" });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
        role: role || "STAFF",
      },
    });

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Get all users (admin only)
app.get("/api/users", authenticateToken, isAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ============================================
// WORKSPACE TYPE ROUTES (WITH CAPACITY)
// ============================================

// Get all workspace types with availability
app.get("/api/workspace-types", authenticateToken, async (req, res) => {
  try {
    const { date } = req.query;
    const checkDate = date ? new Date(date) : new Date();

    const workspaceTypes = await prisma.workspaceType.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });

    // Calculate available capacity for each workspace type
    const workspaceWithAvailability = await Promise.all(
      workspaceTypes.map(async (workspace) => {
        // Count bookings for the specified date
        const bookedCount = await prisma.usageRecord.count({
          where: {
            workspaceTypeId: workspace.id,
            usageDate: {
              gte: new Date(checkDate.setHours(0, 0, 0, 0)),
              lte: new Date(checkDate.setHours(23, 59, 59, 999)),
            },
          },
        });

        return {
          ...workspace,
          bookedSpaces: bookedCount,
          availableSpaces: workspace.capacity - bookedCount,
          isFullyBooked: bookedCount >= workspace.capacity,
        };
      })
    );

    res.json(workspaceWithAvailability);
  } catch (error) {
    console.error("Error fetching workspace types:", error);
    res.status(500).json({ error: "Failed to fetch workspace types" });
  }
});

// Create workspace type with capacity (admin only)
app.post("/api/workspace-types", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { name, capacity } = req.body;

    if (!name || !capacity) {
      return res.status(400).json({ error: "Workspace type name and capacity required" });
    }

    if (capacity < 1) {
      return res.status(400).json({ error: "Capacity must be at least 1" });
    }

    const workspaceType = await prisma.workspaceType.create({
      data: { 
        name,
        capacity: parseInt(capacity),
      },
    });

    res.status(201).json(workspaceType);
  } catch (error) {
    console.error("Error creating workspace type:", error);
    res.status(500).json({ error: "Failed to create workspace type" });
  }
});

// Update workspace type capacity (admin only)
app.put("/api/workspace-types/:id", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, capacity, isActive } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (capacity) updateData.capacity = parseInt(capacity);
    if (typeof isActive === 'boolean') updateData.isActive = isActive;

    const workspaceType = await prisma.workspaceType.update({
      where: { id },
      data: updateData,
    });

    res.json({
      message: "Workspace type updated successfully",
      workspaceType,
    });
  } catch (error) {
    console.error("Error updating workspace type:", error);
    res.status(500).json({ error: "Failed to update workspace type" });
  }
});

// Delete workspace type (admin only)
app.delete("/api/workspace-types/:id", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if workspace type has any bookings
    const bookingsCount = await prisma.usageRecord.count({
      where: { workspaceTypeId: id },
    });

    if (bookingsCount > 0) {
      return res.status(400).json({ 
        error: "Cannot delete workspace type with existing bookings",
        bookingsCount,
        suggestion: "You can deactivate it instead by setting isActive to false"
      });
    }

    await prisma.workspaceType.delete({
      where: { id },
    });

    res.json({ message: "Workspace type deleted successfully" });
  } catch (error) {
    console.error("Error deleting workspace type:", error);
    res.status(500).json({ error: "Failed to delete workspace type" });
  }
});

// ============================================
// BOOKING / USAGE RECORD ROUTES
// ============================================



app.post("/api/bookings", authenticateToken, async (req, res) => {
  try {
    const { 
      customerName, 
      phoneNumber, 
      amountPaid, 
      paymentMethod, 
      startDate, 
      duration, 
      durationType, 
      workspaceTypeId 
    } = req.body;

    // 1. Validate all fields matching the frontend modal
    if (!customerName || !phoneNumber || !amountPaid || !paymentMethod || !startDate || !duration || !durationType || !workspaceTypeId) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (!["TRANSFER", "POS"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Invalid payment method. Only TRANSFER and POS are allowed" });
    }

    // Check workspace exists
    const workspaceType = await prisma.workspaceType.findUnique({
      where: { id: workspaceTypeId },
    });

    if (!workspaceType) {
      return res.status(404).json({ error: "Workspace type not found" });
    }

    // 2. Parse and compute dates based on duration
    const bookingStart = new Date(startDate);
    bookingStart.setHours(0, 0, 0, 0); // Normalized start of the day

    const bookingEnd = new Date(bookingStart);
    const durationNum = parseInt(duration);

    if (durationType === "MONTHS") {
      bookingEnd.setMonth(bookingEnd.getMonth() + durationNum);
    } else {
      bookingEnd.setDate(bookingEnd.getDate() + durationNum);
    }
    bookingEnd.setDate(bookingEnd.getDate() - 1); // Inclusive logic matching your frontend
    bookingEnd.setHours(23, 59, 59, 999); // Final millisecond of the end day

    // 3. Conflict Check for the entire duration block
    const overlappingBookings = await prisma.usageRecord.findMany({
      where: {
        workspaceTypeId,
        AND: [
          { usageDate: { lte: bookingEnd } },
          { endDateTime: { gte: bookingStart } }
        ]
      }
    });

    if (overlappingBookings.length >= workspaceType.capacity) {
      return res.status(400).json({ error: "No available slots for this selected date range" });
    }

    // 4. Create record with phone number and distinct dates
    const booking = await prisma.usageRecord.create({
      data: {
        customerName,
        customerPhone: phoneNumber, // Saved to our new schema field
        amountPaid: parseFloat(amountPaid),
        paymentMethod,
        usageDate: bookingStart,
        endDateTime: bookingEnd,
        duration: `${durationNum} ${durationType.toLowerCase()}`,
        staffId: req.user.id,
        workspaceTypeId,
      },
      include: {
        staff: { select: { id: true, name: true, email: true } },
        workspaceType: true,
      },
    });

    res.status(201).json({
      message: "Booking created successfully",
      booking,
      bookingPeriod: {
        start: bookingStart,
        end: bookingEnd,
        duration: `${durationNum} ${durationType.toLowerCase()}`,
      }
    });
  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({ error: "Failed to create booking" });
  }
});



// Add this helper endpoint to check availability for a specific date/time
app.get("/api/bookings/check-availability", authenticateToken, async (req, res) => {
  try {
    const { workspaceTypeId, dateTime } = req.query;

    if (!workspaceTypeId || !dateTime) {
      return res.status(400).json({ error: "Workspace type and date/time required" });
    }

    const workspaceType = await prisma.workspaceType.findUnique({
      where: { id: workspaceTypeId },
    });

    if (!workspaceType) {
      return res.status(404).json({ error: "Workspace type not found" });
    }

    const checkTime = new Date(dateTime);
    
    // End time is always 11:59 PM same day
    const endTime = new Date(checkTime);
    endTime.setHours(23, 59, 59, 999);

    // Define the day boundaries
    const startOfDay = new Date(checkTime);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(checkTime);
    endOfDay.setHours(23, 59, 59, 999);

    // Find overlapping bookings for this day
    const overlappingBookings = await prisma.usageRecord.findMany({
      where: {
        workspaceTypeId,
        AND: [
          { usageDate: { lte: endOfDay } },
          { endDateTime: { gte: startOfDay } }
        ]
      },
      include: {
        staff: { select: { name: true } }
      }
    });

    const availableSlots = workspaceType.capacity - overlappingBookings.length;

    res.json({
      available: availableSlots > 0,
      totalCapacity: workspaceType.capacity,
      bookedSlots: overlappingBookings.length,
      availableSlots,
      bookingPeriod: {
        start: checkTime,
        end: endTime,
        duration: "Day"
      },
      existingBookings: overlappingBookings.map(b => ({
        customerName: b.customerName,
        start: b.usageDate,
        end: b.endDateTime,
        duration: b.duration
      }))
    });
  } catch (error) {
    console.error("Error checking availability:", error);
    res.status(500).json({ error: "Failed to check availability" });
  }
});

// Get all bookings with filters
app.get("/api/bookings", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, staffId, workspaceTypeId, paymentMethod } = req.query;

    const where = {};

    if (startDate || endDate) {
      where.usageDate = {};
      if (startDate) where.usageDate.gte = new Date(startDate);
      if (endDate) where.usageDate.lte = new Date(endDate);
    }

    if (staffId) where.staffId = staffId;
    if (workspaceTypeId) where.workspaceTypeId = workspaceTypeId;
    if (paymentMethod) where.paymentMethod = paymentMethod;

    // Staff can only see their own bookings
    if (req.user.role === "STAFF") {
      where.staffId = req.user.id;
    }

    const bookings = await prisma.usageRecord.findMany({
      where,
      include: {
        staff: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        workspaceType: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(bookings);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
});

// Get single booking
app.get("/api/bookings/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await prisma.usageRecord.findUnique({
      where: { id },
      include: {
        staff: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        workspaceType: true,
      },
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (req.user.role === "STAFF" && booking.staffId !== req.user.id) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json(booking);
  } catch (error) {
    console.error("Error fetching booking:", error);
    res.status(500).json({ error: "Failed to fetch booking" });
  }
});

// Update booking (admin only)
app.put("/api/bookings/:id", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { customerName, amountPaid, paymentMethod, usageDate, workspaceTypeId } = req.body;

    const updateData = {};
    if (customerName) updateData.customerName = customerName;
    if (amountPaid) updateData.amountPaid = parseFloat(amountPaid);
    if (paymentMethod) updateData.paymentMethod = paymentMethod;
    if (usageDate) updateData.usageDate = new Date(usageDate);
    if (workspaceTypeId) updateData.workspaceTypeId = workspaceTypeId;

    const booking = await prisma.usageRecord.update({
      where: { id },
      data: updateData,
      include: {
        staff: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        workspaceType: true,
      },
    });

    res.json({
      message: "Booking updated successfully",
      booking,
    });
  } catch (error) {
    console.error("Error updating booking:", error);
    res.status(500).json({ error: "Failed to update booking" });
  }
});

// Delete booking (admin only)
app.delete("/api/bookings/:id", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.usageRecord.delete({
      where: { id },
    });

    res.json({ message: "Booking deleted successfully" });
  } catch (error) {
    console.error("Error deleting booking:", error);
    res.status(500).json({ error: "Failed to delete booking" });
  }
});

// ============================================
// EXPORT ROUTES
// ============================================

// Helper function to format date as DD/MM/YYYY
const formatDate = (date) => {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

// Export bookings as CSV with date range
app.get("/api/bookings/export/csv", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, staffId, workspaceTypeId } = req.query;

    const where = {};

    if (startDate || endDate) {
      where.usageDate = {};
      if (startDate) where.usageDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.usageDate.lte = end;
      }
    }

    if (staffId) where.staffId = staffId;
    if (workspaceTypeId) where.workspaceTypeId = workspaceTypeId;

    // Staff can only export their own bookings
    if (req.user.role === "STAFF") {
      where.staffId = req.user.id;
    }

    const bookings = await prisma.usageRecord.findMany({
      where,
      include: {
        staff: {
          select: {
            name: true,
            email: true,
          },
        },
        workspaceType: true,
      },
      orderBy: {
        usageDate: "desc",
      },
    });

    // Calculate total
    const total = bookings.reduce((sum, booking) => sum + booking.amountPaid, 0);

    // Transform data for CSV
    const csvData = bookings.map((booking, index) => ({
      'S/N': index + 1,
      'CUSTOMER NAME': booking.customerName,
      'WORKSPACE TYPE': booking.workspaceType.name,
      'USAGE DATE': formatDate(booking.usageDate),
      'DURATION': booking.duration || 'Day',
      'AMOUNT (NGN)': booking.amountPaid,
      'PAYMENT METHOD': booking.paymentMethod,
      'STAFF NAME': booking.staff.name,
    }));

    const parser = new Parser();
    const csv = parser.parse(csvData);

    // Create header and footer
    const currentDate = formatDate(new Date());
    const dateRangeText = startDate && endDate 
      ? `\nDate Range: ${formatDate(startDate)} - ${formatDate(endDate)}`
      : startDate 
      ? `\nFrom: ${formatDate(startDate)}`
      : endDate 
      ? `\nUntil: ${formatDate(endDate)}`
      : '';
    
    const header = `AMARA CENTRE: WORKSPACE BOOKINGS\nGenerated: ${currentDate}${dateRangeText}\n\nBookings\n`;
    const footer = `\n\nTOTAL,,,,,${total.toLocaleString()}`;

    const finalCsv = header + csv + footer;

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename=bookings-export-${currentDate.replace(/\//g, '-')}.csv`);
    res.send(finalCsv);
  } catch (error) {
    console.error("Error exporting bookings:", error);
    res.status(500).json({ error: "Failed to export bookings" });
  }
});
// Export inflow records as CSV
app.post("/api/inflow/export/csv", authenticateToken, async (req, res) => {
  try {
    const { recordIds, startDate, endDate } = req.body;

    const where = {};
    
    if (recordIds && recordIds.length > 0) {
      where.id = { in: recordIds };
    }

    if (startDate || endDate) {
      where.startDate = {};
      if (startDate) where.startDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.startDate.lte = end;
      }
    }

    if (req.user.role === "STAFF") {
      where.createdById = req.user.id;
    }

    const inflows = await prisma.inflow.findMany({
      where,
      include: {
        createdBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        startDate: "desc",
      },
    });

    // Calculate total
    const total = inflows.reduce((sum, record) => sum + record.amount, 0);

    // Transform data for CSV
    const csvData = inflows.map((record, index) => ({
      'S/N': index + 1,
      'LOCATION': record.name,
      'DATE': formatDate(record.startDate),
      'DURATION': record.duration || 'N/A',
      'AMOUNT (NGN)': record.amount,
    }));

    const parser = new Parser();
    const csv = parser.parse(csvData);

    // Create header and footer
    const currentDate = formatDate(new Date());
    const dateRangeText = startDate && endDate 
      ? `\nDate Range: ${formatDate(startDate)} - ${formatDate(endDate)}`
      : startDate 
      ? `\nFrom: ${formatDate(startDate)}`
      : endDate 
      ? `\nUntil: ${formatDate(endDate)}`
      : '';
    
    const header = `AMARA CENTRE: ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase()}\n${dateRangeText}\n\nInflows\n`;
    const footer = `\n\n,,,,${total.toLocaleString()}`;

    const finalCsv = header + csv + footer;

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename=inflow-export-${currentDate.replace(/\//g, '-')}.csv`);
    res.send(finalCsv);
  } catch (error) {
    console.error("Error exporting inflow:", error);
    res.status(500).json({ error: "Failed to export inflow records" });
  }
});

// Export expenses as CSV
app.post("/api/expenses/export/csv", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { recordIds, startDate, endDate } = req.body;

    const where = {};
    
    if (recordIds && recordIds.length > 0) {
      where.id = { in: recordIds };
    }

    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.expenseDate.lte = end;
      }
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        createdBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        expenseDate: "desc",
      },
    });

    // Calculate total
    const total = expenses.reduce((sum, record) => sum + record.amount, 0);

    // Transform data for CSV
    const csvData = expenses.map((expense, index) => ({
      'S/N': index + 1,
      'ITEM DESCRIPTION': expense.description,
      'UNIT': 1,
      'AMOUNT (NGN)': expense.amount,
    }));

    const parser = new Parser();
    const csv = parser.parse(csvData);

    // Create header and footer
    const currentDate = formatDate(new Date());
    const dateRangeText = startDate && endDate 
      ? `\nDate Range: ${formatDate(startDate)} - ${formatDate(endDate)}`
      : startDate 
      ? `\nFrom: ${formatDate(startDate)}`
      : endDate 
      ? `\nUntil: ${formatDate(endDate)}`
      : '';
    
    const header = `AMARA CENTRE: ${new Date().toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase()}\n${dateRangeText}\n\nOutflows\n`;
    const footer = `\n\n,,,${total.toLocaleString()}`;

    const finalCsv = header + csv + footer;

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename=outflow-export-${currentDate.replace(/\//g, '-')}.csv`);
    res.send(finalCsv);
  } catch (error) {
    console.error("Error exporting expenses:", error);
    res.status(500).json({ error: "Failed to export expenses" });
  }
});


// Export bookings as JSON (bulk)
app.get("/api/bookings/export/json", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, staffId, workspaceTypeId } = req.query;

    const where = {};

    if (startDate || endDate) {
      where.usageDate = {};
      if (startDate) where.usageDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.usageDate.lte = end;
      }
    }

    if (staffId) where.staffId = staffId;
    if (workspaceTypeId) where.workspaceTypeId = workspaceTypeId;

    // Staff can only export their own bookings
    if (req.user.role === "STAFF") {
      where.staffId = req.user.id;
    }

    const bookings = await prisma.usageRecord.findMany({
      where,
      include: {
        staff: {
          select: {
            name: true,
            email: true,
          },
        },
        workspaceType: true,
      },
      orderBy: {
        usageDate: "desc",
      },
    });

    // Calculate total
    const total = bookings.reduce((sum, booking) => sum + booking.amountPaid, 0);

    // Transform data for JSON
    const transformedBookings = bookings.map(booking => ({
      customerName: booking.customerName,
      amountPaid: booking.amountPaid,
      paymentMethod: booking.paymentMethod,
      usageDate: formatDate(booking.usageDate),
      endDate: formatDate(booking.endDateTime),
      duration: booking.duration || 'Day',
      workspaceType: booking.workspaceType.name,
      staffName: booking.staff.name,
      staffEmail: booking.staff.email,
      createdAt: formatDate(booking.createdAt),
    }));

    res.header('Content-Type', 'application/json');
    res.header('Content-Disposition', 'attachment; filename=bookings-export.json');
    res.json({
      exportDate: formatDate(new Date()),
      totalRecords: transformedBookings.length,
      totalAmount: total,
      currency: "NGN",
      filters: { 
        startDate: startDate ? formatDate(startDate) : null, 
        endDate: endDate ? formatDate(endDate) : null, 
        staffId, 
        workspaceTypeId 
      },
      bookings: transformedBookings,
    });
  } catch (error) {
    console.error("Error exporting bookings:", error);
    res.status(500).json({ error: "Failed to export bookings" });
  }
});







// Export inflow records as JSON
app.post("/api/inflow/export/json", authenticateToken, async (req, res) => {
  try {
    const { recordIds, startDate, endDate } = req.body;

    const where = {};
    
    if (recordIds && recordIds.length > 0) {
      where.id = { in: recordIds };
    }

    if (startDate || endDate) {
      where.startDate = {};
      if (startDate) where.startDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.startDate.lte = end;
      }
    }

    if (req.user.role === "STAFF") {
      where.createdById = req.user.id;
    }

    const inflows = await prisma.inflow.findMany({
      where,
      include: {
        createdBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        startDate: "desc",
      },
    });

    const total = inflows.reduce((sum, record) => sum + record.amount, 0);

    // Transform data for JSON
    const transformedInflows = inflows.map(record => ({
      name: record.name,
      category: record.category,
      amount: record.amount,
      duration: record.duration || 'N/A',
      startDate: formatDate(record.startDate),
      endDate: record.endDate ? formatDate(record.endDate) : 'N/A',
      description: record.description || '-',
      createdBy: record.createdBy.name,
      createdAt: formatDate(record.createdAt),
    }));

    res.header('Content-Type', 'application/json');
    res.header('Content-Disposition', `attachment; filename=inflow-export-${formatDate(new Date()).replace(/\//g, '-')}.json`);
    res.json({
      type: "INFLOW",
      exportDate: formatDate(new Date()),
      totalRecords: transformedInflows.length,
      totalAmount: total,
      currency: "NGN",
      filters: {
        startDate: startDate ? formatDate(startDate) : null,
        endDate: endDate ? formatDate(endDate) : null,
      },
      records: transformedInflows,
    });
  } catch (error) {
    console.error("Error exporting inflow:", error);
    res.status(500).json({ error: "Failed to export inflow records" });
  }
});



// Export expenses as JSON (with selected records)
app.post("/api/expenses/export/json", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { recordIds, startDate, endDate } = req.body;

    const where = {};
    
    if (recordIds && recordIds.length > 0) {
      where.id = { in: recordIds };
    }

    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.expenseDate.lte = end;
      }
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        createdBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        expenseDate: "desc",
      },
    });

    const total = expenses.reduce((sum, record) => sum + record.amount, 0);

    // Transform data for JSON
    const transformedExpenses = expenses.map(expense => ({
      description: expense.description,
      category: expense.category,
      amount: expense.amount,
      expenseDate: formatDate(expense.expenseDate),
      createdBy: expense.createdBy.name,
      createdAt: formatDate(expense.createdAt),
    }));

    res.header('Content-Type', 'application/json');
    res.header('Content-Disposition', `attachment; filename=outflow-export-${formatDate(new Date()).replace(/\//g, '-')}.json`);
    res.json({
      type: "OUTFLOW",
      exportDate: formatDate(new Date()),
      totalRecords: transformedExpenses.length,
      totalAmount: total,
      currency: "NGN",
      filters: {
        startDate: startDate ? formatDate(startDate) : null,
        endDate: endDate ? formatDate(endDate) : null,
      },
      records: transformedExpenses,
    });
  } catch (error) {
    console.error("Error exporting expenses:", error);
    res.status(500).json({ error: "Failed to export expenses" });
  }
});
// ============================================
// EXPENSE ROUTES (OUTFLOW)
// ============================================

// Create expense (admin only)
app.post("/api/expenses", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { description, amount, category, expenseDate } = req.body;

    if (!description || !amount || !expenseDate) {
      return res.status(400).json({ error: "Description, amount, and date are required" });
    }

    const expense = await prisma.expense.create({
      data: {
        description,
        amount: parseFloat(amount),
        category: category || "GENERAL",
        expenseDate: new Date(expenseDate),
        createdById: req.user.id,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json({
      message: "Expense created successfully",
      expense,
    });
  } catch (error) {
    console.error("Error creating expense:", error);
    res.status(500).json({ error: "Failed to create expense" });
  }
});

// Get all expenses (admin only)
app.get("/api/expenses", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;

    const where = {};

    if (startDate || endDate) {
      where.expenseDate = {};
      if (startDate) where.expenseDate.gte = new Date(startDate);
      if (endDate) where.expenseDate.lte = new Date(endDate);
    }

    if (category) where.category = category;

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        expenseDate: "desc",
      },
    });

    res.json(expenses);
  } catch (error) {
    console.error("Error fetching expenses:", error);
    res.status(500).json({ error: "Failed to fetch expenses" });
  }
});

// Update expense (admin only)
app.put("/api/expenses/:id", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { description, amount, category, expenseDate } = req.body;

    const updateData = {};
    if (description) updateData.description = description;
    if (amount) updateData.amount = parseFloat(amount);
    if (category) updateData.category = category;
    if (expenseDate) updateData.expenseDate = new Date(expenseDate);

    const expense = await prisma.expense.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json({
      message: "Expense updated successfully",
      expense,
    });
  } catch (error) {
    console.error("Error updating expense:", error);
    res.status(500).json({ error: "Failed to update expense" });
  }
});

// Delete expense (admin only)
app.delete("/api/expenses/:id", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.expense.delete({
      where: { id },
    });

    res.json({ message: "Expense deleted successfully" });
  } catch (error) {
    console.error("Error deleting expense:", error);
    res.status(500).json({ error: "Failed to delete expense" });
  }
});

// ============================================
// ANALYTICS ROUTES (ADMIN ONLY)
// ============================================

// Get comprehensive financial statistics (admin only)
app.get("/api/analytics/stats", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {};
    if (startDate || endDate) {
      where.usageDate = {};
      if (startDate) where.usageDate.gte = new Date(startDate);
      if (endDate) where.usageDate.lte = new Date(endDate);
    }

    const expenseWhere = {};
    if (startDate || endDate) {
      expenseWhere.expenseDate = {};
      if (startDate) expenseWhere.expenseDate.gte = new Date(startDate);
      if (endDate) expenseWhere.expenseDate.lte = new Date(endDate);
    }

    // Total bookings (inflow)
    const totalBookings = await prisma.usageRecord.count({ where });

    // Total revenue (inflow)
    const revenueData = await prisma.usageRecord.aggregate({
      where,
      _sum: {
        amountPaid: true,
      },
    });

    // Total expenses (outflow)
    const expenseData = await prisma.expense.aggregate({
      where: expenseWhere,
      _sum: {
        amount: true,
      },
    });

    const totalRevenue = revenueData._sum.amountPaid || 0;
    const totalExpenses = expenseData._sum.amount || 0;
    const netIncome = totalRevenue - totalExpenses;

    // Bookings by payment method
    const byPaymentMethod = await prisma.usageRecord.groupBy({
      by: ["paymentMethod"],
      where,
      _count: true,
      _sum: {
        amountPaid: true,
      },
    });

    // Bookings by workspace type
    const byWorkspaceType = await prisma.usageRecord.groupBy({
      by: ["workspaceTypeId"],
      where,
      _count: true,
      _sum: {
        amountPaid: true,
      },
    });

    // Expenses by category
    const byExpenseCategory = await prisma.expense.groupBy({
      by: ["category"],
      where: expenseWhere,
      _count: true,
      _sum: {
        amount: true,
      },
    });

    // Get workspace type names
    const workspaceTypes = await prisma.workspaceType.findMany();
    const workspaceMap = Object.fromEntries(
      workspaceTypes.map(ws => [ws.id, ws.name])
    );

    const workspaceStats = byWorkspaceType.map(item => ({
      workspaceType: workspaceMap[item.workspaceTypeId],
      count: item._count,
      revenue: item._sum.amountPaid,
    }));

    res.json({
      totalBookings,
      totalRevenue,
      totalExpenses,
      netIncome,
      profitMargin: totalRevenue > 0 ? ((netIncome / totalRevenue) * 100).toFixed(2) + '%' : '0%',
      byPaymentMethod,
      byWorkspaceType: workspaceStats,
      byExpenseCategory,
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Get staff performance (admin only)
app.get("/api/analytics/staff-performance", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const where = {};
    if (startDate || endDate) {
      where.usageDate = {};
      if (startDate) where.usageDate.gte = new Date(startDate);
      if (endDate) where.usageDate.lte = new Date(endDate);
    }

    const staffPerformance = await prisma.usageRecord.groupBy({
      by: ["staffId"],
      where,
      _count: true,
      _sum: {
        amountPaid: true,
      },
    });

    // Get staff details
    const staffIds = staffPerformance.map(sp => sp.staffId);
    const staffMembers = await prisma.user.findMany({
      where: { id: { in: staffIds } },
      select: { id: true, name: true, email: true },
    });

    const staffMap = Object.fromEntries(
      staffMembers.map(staff => [staff.id, staff])
    );

    const performanceData = staffPerformance.map(item => ({
      staff: staffMap[item.staffId],
      bookingsCount: item._count,
      totalRevenue: item._sum.amountPaid,
    }));

    res.json(performanceData);
  } catch (error) {
    console.error("Error fetching staff performance:", error);
    res.status(500).json({ error: "Failed to fetch staff performance" });
  }
});


// ============================================
// INFLOW ROUTES (Room Rentals, Conference, etc.)
// ============================================

// Create inflow record
app.post("/api/inflow", authenticateToken, async (req, res) => {
  try {
    const { name, category, amount, duration, startDate, endDate, description } = req.body;

    if (!name || !category || !amount || !startDate) {
      return res.status(400).json({ error: "Name, category, amount, and start date are required" });
    }

    const inflow = await prisma.inflow.create({
      data: {
        name,
        category,
        amount: parseFloat(amount),
        duration: duration || null,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        description: description || null,
        createdById: req.user.id,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(201).json({
      message: "Inflow record created successfully",
      inflow,
    });
  } catch (error) {
    console.error("Error creating inflow:", error);
    res.status(500).json({ error: "Failed to create inflow record" });
  }
});

// Get all inflow records
app.get("/api/inflow", authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, category } = req.query;

    const where = {};

    if (startDate || endDate) {
      where.startDate = {};
      if (startDate) where.startDate.gte = new Date(startDate);
      if (endDate) where.startDate.lte = new Date(endDate);
    }

    if (category) where.category = category;

    // Staff can only see their own records
    if (req.user.role === "STAFF") {
      where.createdById = req.user.id;
    }

    const inflows = await prisma.inflow.findMany({
      where,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.json(inflows);
  } catch (error) {
    console.error("Error fetching inflow records:", error);
    res.status(500).json({ error: "Failed to fetch inflow records" });
  }
});

// Update inflow record (admin only)
app.put("/api/inflow/:id", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, amount, duration, startDate, endDate, description } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (category) updateData.category = category;
    if (amount) updateData.amount = parseFloat(amount);
    if (duration !== undefined) updateData.duration = duration;
    if (startDate) updateData.startDate = new Date(startDate);
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (description !== undefined) updateData.description = description;

    const inflow = await prisma.inflow.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.json({
      message: "Inflow record updated successfully",
      inflow,
    });
  } catch (error) {
    console.error("Error updating inflow:", error);
    res.status(500).json({ error: "Failed to update inflow record" });
  }
});

// Delete inflow record (admin only)
app.delete("/api/inflow/:id", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.inflow.delete({
      where: { id },
    });

    res.json({ message: "Inflow record deleted successfully" });
  } catch (error) {
    console.error("Error deleting inflow:", error);
    res.status(500).json({ error: "Failed to delete inflow record" });
  }
});

// Export inflow records as CSV
app.post("/api/inflow/export/csv", authenticateToken, async (req, res) => {
  try {
    const { recordIds } = req.body;

    const where = {};
    
    // If specific records selected, filter by IDs
    if (recordIds && recordIds.length > 0) {
      where.id = { in: recordIds };
    }

    // Staff can only export their own records
    if (req.user.role === "STAFF") {
      where.createdById = req.user.id;
    }

    const inflows = await prisma.inflow.findMany({
      where,
      include: {
        createdBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        startDate: "desc",
      },
    });

    // Calculate total
    const total = inflows.reduce((sum, record) => sum + record.amount, 0);

    // Transform data for CSV
    const csvData = inflows.map(record => ({
      ID: record.id,
      Name: record.name,
      Category: record.category,
      Amount: record.amount,
      Duration: record.duration || 'N/A',
      'Start Date': record.startDate.toISOString().split('T')[0],
      'End Date': record.endDate ? record.endDate.toISOString().split('T')[0] : 'N/A',
      Description: record.description || '-',
      'Created By': record.createdBy.name,
      'Created At': record.createdAt.toISOString(),
    }));

    const parser = new Parser();
    const csv = parser.parse(csvData);

    // Add header with total
    const header = `INFLOW REPORT\nTotal Amount: NGN ${total.toLocaleString()}\nTotal Records: ${inflows.length}\nGenerated: ${new Date().toISOString()}\n\n`;
    const finalCsv = header + csv;

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename=inflow-export-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(finalCsv);
  } catch (error) {
    console.error("Error exporting inflow:", error);
    res.status(500).json({ error: "Failed to export inflow records" });
  }
});

// Export inflow records as JSON
app.post("/api/inflow/export/json", authenticateToken, async (req, res) => {
  try {
    const { recordIds } = req.body;

    const where = {};
    
    if (recordIds && recordIds.length > 0) {
      where.id = { in: recordIds };
    }

    if (req.user.role === "STAFF") {
      where.createdById = req.user.id;
    }

    const inflows = await prisma.inflow.findMany({
      where,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        startDate: "desc",
      },
    });

    const total = inflows.reduce((sum, record) => sum + record.amount, 0);

    res.header('Content-Type', 'application/json');
    res.header('Content-Disposition', `attachment; filename=inflow-export-${new Date().toISOString().split('T')[0]}.json`);
    res.json({
      type: "INFLOW",
      exportDate: new Date().toISOString(),
      totalRecords: inflows.length,
      totalAmount: total,
      currency: "NGN",
      records: inflows,
    });
  } catch (error) {
    console.error("Error exporting inflow:", error);
    res.status(500).json({ error: "Failed to export inflow records" });
  }
});

// ============================================
// UPDATED OUTFLOW/EXPENSE EXPORT ROUTES
// ============================================

// Export expenses as CSV (with selected records)
app.post("/api/expenses/export/csv", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { recordIds } = req.body;

    const where = {};
    
    if (recordIds && recordIds.length > 0) {
      where.id = { in: recordIds };
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        createdBy: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        expenseDate: "desc",
      },
    });

    const total = expenses.reduce((sum, record) => sum + record.amount, 0);

    const csvData = expenses.map(expense => ({
      ID: expense.id,
      Description: expense.description,
      Category: expense.category,
      Amount: expense.amount,
      'Expense Date': expense.expenseDate.toISOString().split('T')[0],
      'Created By': expense.createdBy.name,
      'Created At': expense.createdAt.toISOString(),
    }));

    const parser = new Parser();
    const csv = parser.parse(csvData);

    const header = `OUTFLOW REPORT (EXPENSES)\nTotal Amount: NGN ${total.toLocaleString()}\nTotal Records: ${expenses.length}\nGenerated: ${new Date().toISOString()}\n\n`;
    const finalCsv = header + csv;

    res.header('Content-Type', 'text/csv');
    res.header('Content-Disposition', `attachment; filename=outflow-export-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(finalCsv);
  } catch (error) {
    console.error("Error exporting expenses:", error);
    res.status(500).json({ error: "Failed to export expenses" });
  }
});

// Export expenses as JSON (with selected records)
app.post("/api/expenses/export/json", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { recordIds } = req.body;

    const where = {};
    
    if (recordIds && recordIds.length > 0) {
      where.id = { in: recordIds };
    }

    const expenses = await prisma.expense.findMany({
      where,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        expenseDate: "desc",
      },
    });

    const total = expenses.reduce((sum, record) => sum + record.amount, 0);

    res.header('Content-Type', 'application/json');
    res.header('Content-Disposition', `attachment; filename=outflow-export-${new Date().toISOString().split('T')[0]}.json`);
    res.json({
      type: "OUTFLOW",
      exportDate: new Date().toISOString(),
      totalRecords: expenses.length,
      totalAmount: total,
      currency: "NGN",
      records: expenses,
    });
  } catch (error) {
    console.error("Error exporting expenses:", error);
    res.status(500).json({ error: "Failed to export expenses" });
  }
});

// ============================================
// UPDATED ANALYTICS TO INCLUDE INFLOW
// ============================================

// Updated analytics endpoint
app.get("/api/analytics/stats", authenticateToken, isAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const bookingWhere = {};
    const inflowWhere = {};
    const expenseWhere = {};

    if (startDate || endDate) {
      if (startDate || endDate) {
        bookingWhere.usageDate = {};
        if (startDate) bookingWhere.usageDate.gte = new Date(startDate);
        if (endDate) bookingWhere.usageDate.lte = new Date(endDate);
      }

      if (startDate || endDate) {
        inflowWhere.startDate = {};
        if (startDate) inflowWhere.startDate.gte = new Date(startDate);
        if (endDate) inflowWhere.startDate.lte = new Date(endDate);
      }

      if (startDate || endDate) {
        expenseWhere.expenseDate = {};
        if (startDate) expenseWhere.expenseDate.gte = new Date(startDate);
        if (endDate) expenseWhere.expenseDate.lte = new Date(endDate);
      }
    }

    // Bookings revenue
    const bookingData = await prisma.usageRecord.aggregate({
      where: bookingWhere,
      _sum: { amountPaid: true },
      _count: true,
    });

    // Inflow revenue
    const inflowData = await prisma.inflow.aggregate({
      where: inflowWhere,
      _sum: { amount: true },
      _count: true,
    });

    // Expenses
    const expenseData = await prisma.expense.aggregate({
      where: expenseWhere,
      _sum: { amount: true },
      _count: true,
    });

    const bookingRevenue = bookingData._sum.amountPaid || 0;
    const inflowRevenue = inflowData._sum.amount || 0;
    const totalRevenue = bookingRevenue + inflowRevenue;
    const totalExpenses = expenseData._sum.amount || 0;
    const netIncome = totalRevenue - totalExpenses;

    res.json({
      totalBookings: bookingData._count,
      bookingRevenue,
      totalInflow: inflowData._count,
      inflowRevenue,
      totalRevenue,
      totalExpenses,
      netIncome,
      profitMargin: totalRevenue > 0 ? ((netIncome / totalRevenue) * 100).toFixed(2) + '%' : '0%',
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});


export default app;