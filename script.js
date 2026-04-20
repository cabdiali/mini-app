// Firebase Initialization
const isFirebaseReady = typeof firebase !== 'undefined' && firebaseConfig && firebaseConfig.apiKey !== "YOUR_API_KEY";

if (isFirebaseReady) {
    if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    var db = firebase.firestore();
    var auth = firebase.auth();
}

// Core State & Logic for Multi-Page App
let state = {
    students: JSON.parse(localStorage.getItem('qsms_v2_students')) || [],
    teachers: JSON.parse(localStorage.getItem('qsms_v2_teachers')) || [],
    attendance: JSON.parse(localStorage.getItem('qsms_v2_attendance')) || {},
    payments: JSON.parse(localStorage.getItem('qsms_v2_payments')) || [],
    gradeFees: {
        'Grade 4': 200, 'Grade 5': 220, 'Grade 6': 240, 'Grade 7': 260, 'Grade 8': 280, 'Grade 9': 300, 'Grade 10': 320, 'Grade 11': 340, 'Grade 12': 360
    },
    currentRole: localStorage.getItem('qsms_v2_role') || null,
    currentUser: JSON.parse(localStorage.getItem('qsms_v2_user')) || null,
    isLoggedIn: localStorage.getItem('qsms_v2_isLoggedIn') === 'true',
    isCloudSynced: false
};

// Data Migration for Teachers (assignedClass -> assignedGrades)
state.teachers.forEach(t => {
    if (t.assignedClass && !t.assignedGrades) {
        t.assignedGrades = [{
            grade: t.assignedClass,
            status: 'Approved',
            canManagePayments: t.canManagePayments || false
        }];
        delete t.assignedClass;
    }
});

// Update localStorage if migrated
localStorage.setItem('qsms_v2_teachers', JSON.stringify(state.teachers));

// Ensure currentUser is synced with latest teacher data if logged in
if (state.currentRole === 'teacher' && state.currentUser) {
    const latest = state.teachers.find(t => t.id === state.currentUser.id);
    if (latest) state.currentUser = latest;
}


// Firebase Data Sync Logic
const syncLocalToCloud = async () => {
    if (!isFirebaseReady) return alert('Firebase not configured. Please enter your config in firebase-config.js');

    const collections = ['students', 'teachers', 'payments'];

    try {
        for (const col of collections) {
            const data = state[col];
            for (const item of data) {
                // Using ID as doc path for consistency
                await db.collection(col).doc(String(item.id || item.studentId + '_' + item.month)).set(item);
            }
        }
        // Special case for attendance
        for (const date in state.attendance) {
            await db.collection('attendance').doc(date).set({ records: state.attendance[date] });
        }
        alert('Migration to Firebase successful!');
    } catch (e) {
        console.error(e);
        alert('Migration failed: ' + e.message);
    }
};

const loadFromCloud = async () => {
    if (!isFirebaseReady) return;

    try {
        const studentSnap = await db.collection('students').get();
        const cloudStudents = studentSnap.docs.map(doc => doc.data());
        // Merge: Keep local students that aren't in cloud yet (newly registered)
        // Merge & Cleanup: Correctly handle deletions and new local records
        const FIVE_MINUTES = 5 * 60 * 1000;
        const now = Date.now();

        // Sync Students
        state.students = state.students.filter(ls => {
            const inCloud = cloudStudents.find(cs => cs.id == ls.id);
            if (inCloud) return true; // Keep and update later
            // If NOT in cloud, only keep if it's very new (possibly not yet synced)
            return (now - ls.id < FIVE_MINUTES);
        });
        cloudStudents.forEach(cs => {
            const index = state.students.findIndex(ls => ls.id == cs.id);
            if (index > -1) state.students[index] = cs;
            else state.students.push(cs);
        });

        // Sync Teachers
        const teacherSnap = await db.collection('teachers').get();
        const cloudTeachers = teacherSnap.docs.map(doc => doc.data());
        state.teachers = state.teachers.filter(lt => {
            const inCloud = cloudTeachers.find(ct => ct.id == lt.id);
            if (inCloud) return true;
            return (now - lt.id < FIVE_MINUTES);
        });
        cloudTeachers.forEach(ct => {
            const index = state.teachers.findIndex(lt => lt.id == ct.id);
            if (index > -1) state.teachers[index] = ct;
            else state.teachers.push(ct);
        });

        // Sync Payments
        const paymentSnap = await db.collection('payments').get();
        const cloudPayments = paymentSnap.docs.map(doc => doc.data());
        state.payments = state.payments.filter(lp => {
            const inCloud = cloudPayments.find(cp => (cp.studentId + '_' + cp.month) == (lp.studentId + '_' + lp.month));
            if (inCloud) return true;
            // Payments don't have separate IDs with timestamps usually, so we check if the student survives
            return state.students.some(s => s.id == lp.studentId);
        });
        cloudPayments.forEach(cp => {
            const key = cp.studentId + '_' + cp.month;
            const index = state.payments.findIndex(lp => (lp.studentId + '_' + lp.month) == key);
            if (index > -1) state.payments[index] = cp;
            else state.payments.push(cp);
        });

        const attendanceSnap = await db.collection('attendance').get();
        attendanceSnap.docs.forEach(doc => {
            state.attendance[doc.id] = doc.data().records;
        });

        state.isCloudSynced = true;
        console.log('Data loaded/merged from Firebase');

        // Refresh UI logic - using a small delay to ensure page-specific scripts are loaded
        setTimeout(() => {
            if (typeof setupGradeFilter === 'function') setupGradeFilter();

            if (typeof renderDashboard === 'function') renderDashboard();
            if (typeof renderStudents === 'function') renderStudents();
            if (typeof renderTeachers === 'function') renderTeachers();
            if (typeof renderPayments === 'function') renderPayments();
            if (typeof generateReport === 'function') generateReport();
            if (typeof generateAttendanceReport === 'function') generateAttendanceReport();
            if (typeof generatePaymentReport === 'function') generatePaymentReport();
            setupUI();
        }, 100);
    } catch (e) {
        console.error('Cloud load failed, using local data', e);
    }
};

// Global App Utilities
const checkAuth = () => {
    const path = window.location.pathname;
    const isLoginPage = path.endsWith('index.html') || path.endsWith('/') || path === '';

    if (!state.isLoggedIn && !isLoginPage) {
        window.location.href = 'index.html';
    } else if (state.isLoggedIn && isLoginPage) {
        window.location.href = 'dashboard.html';
    }
};

const setupUI = () => {
    // Menu toggle for mobile
    const menuBtn = document.getElementById('menuToggle');
    const closeBtn = document.getElementById('closeSidebar');
    const sidebar = document.getElementById('sidebar');

    if (menuBtn) menuBtn.onclick = () => sidebar.classList.add('active');
    if (closeBtn) closeBtn.onclick = () => sidebar.classList.remove('active');

    // Role-based UI visibility
    const isAdmin = state.currentRole === 'admin';
    const canManagePayments = isAdmin || (state.currentUser && (state.currentUser.assignedGrades || []).some(g => g.status === 'Approved' && g.canManagePayments));

    document.querySelectorAll('.admin-only').forEach(el => {
        if (el.getAttribute('href') === 'payments.html' && canManagePayments) {
            el.style.display = '';
        } else {
            el.style.display = isAdmin ? '' : 'none';
        }
    });

    if (document.getElementById('currentRoleDisplay')) {
        document.getElementById('currentRoleDisplay').innerText = isAdmin ? 'Admin' : 'Teacher';
    }

    // Add Firebase Status Indicator if exists
    if (document.getElementById('dbStatus')) {
        document.getElementById('dbStatus').innerText = isFirebaseReady ? (state.isCloudSynced ? 'Cloud Online' : 'Cloud Connecting...') : 'Local Mode';
        document.getElementById('dbStatus').className = 'badge ' + (isFirebaseReady ? 'badge-paid' : 'badge-pending');
    }

    if (document.getElementById('userNameDisp')) {
        const name = isAdmin ? 'Administrator' : (state.currentUser ? state.currentUser.name : 'Teacher');
        const firstGrade = state.currentUser && state.currentUser.assignedGrades && state.currentUser.assignedGrades[0]
            ? ` (${state.currentUser.assignedGrades[0].grade}${state.currentUser.assignedGrades.length > 1 ? '...' : ''})`
            : '';
        document.getElementById('userNameDisp').innerText = name + firstGrade;
    }

    // Logout logic
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.onclick = () => {
            localStorage.removeItem('qsms_v2_isLoggedIn');
            localStorage.removeItem('qsms_v2_role');
            localStorage.removeItem('qsms_v2_user');
            window.location.href = 'index.html';
        };
    }
};

// Update function helpers
const saveToDb = async (collection, id, data) => {
    if (isFirebaseReady) {
        await db.collection(collection).doc(String(id)).set(data, { merge: true });
    }
    // Still save to local for fallback/cache
    const localKey = 'qsms_v2_' + collection;
    localStorage.setItem(localKey, JSON.stringify(state[collection]));
};

const deleteFromDb = async (collection, id) => {
    if (isFirebaseReady) {
        await db.collection(collection).doc(String(id)).delete();
    }
    const localKey = 'qsms_v2_' + collection;
    localStorage.setItem(localKey, JSON.stringify(state[collection]));
};

// Auto-run on every page load
checkAuth();
setupUI();
if (isFirebaseReady) loadFromCloud();
