var express = require('express');
var router = express.Router();
let { checkLogin } = require('../utils/authHandler');
let reservationModel = require('../schemas/reservations');
let cartModel = require('../schemas/carts');
let inventoryModel = require('../schemas/inventories');
let productModel = require('../schemas/products');
let mongoose = require('mongoose');

// get all reservations của user hiện tại
// GET /reservations/
router.get('/', checkLogin, async function (req, res, next) {
    let reservations = await reservationModel.find({
        user: req.userId
    }).populate('items.product');
    res.send(reservations);
});

// get 1 reservation của user hiện tại
// GET /reservations/:id
router.get('/:id', checkLogin, async function (req, res, next) {
    try {
        let reservation = await reservationModel.findOne({
            _id: req.params.id,
            user: req.userId
        }).populate('items.product');
        if (!reservation) {
            return res.status(404).send({ message: "reservation not found" });
        }
        res.send(reservation);
    } catch (error) {
        res.status(404).send({ message: "reservation not found" });
    }
});

// reserve từ giỏ hàng hiện tại của user
// POST /reservations/reserveACart
router.post('/reserveACart', checkLogin, async function (req, res, next) {
    let session = await mongoose.startSession();
    session.startTransaction();
    try {
        // lấy giỏ hàng của user
        let cart = await cartModel.findOne({ user: req.userId }).session(session);
        if (!cart || cart.cartItems.length === 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).send({ message: "gio hang trong" });
        }

        let items = [];
        let totalAmount = 0;

        for (let cartItem of cart.cartItems) {
            // kiểm tra tồn kho
            let inventory = await inventoryModel.findOne({
                product: cartItem.product
            }).session(session);

            if (!inventory || inventory.stock - inventory.reserved < cartItem.quantity) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).send({
                    message: `san pham ${cartItem.product} khong du hang`
                });
            }

            // lấy thông tin sản phẩm
            let product = await productModel.findById(cartItem.product).session(session);

            let subtotal = product.price * cartItem.quantity;
            totalAmount += subtotal;

            items.push({
                product: cartItem.product,
                quantity: cartItem.quantity,
                title: product.title,
                price: product.price,
                subtotal: subtotal
            });

            // cập nhật reserved trong inventory
            inventory.reserved += cartItem.quantity;
            await inventory.save({ session });
        }

        // tạo reservation với thời hạn 15 phút
        let newReservation = new reservationModel({
            user: req.userId,
            items: items,
            amount: totalAmount,
            status: "actived",
            expiredIn: new Date(Date.now() + 15 * 60 * 1000)
        });
        await newReservation.save({ session });

        // xóa giỏ hàng sau khi reserve
        cart.cartItems = [];
        await cart.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.send(newReservation);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).send({ message: error.message });
    }
});

// reserve từ danh sách sản phẩm truyền vào
// POST /reservations/reserveItems
// body: { items: [{ product: "id", quantity: 1 }, ...] }
router.post('/reserveItems', checkLogin, async function (req, res, next) {
    let session = await mongoose.startSession();
    session.startTransaction();
    try {
        let { items: requestItems } = req.body;

        if (!requestItems || requestItems.length === 0) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).send({ message: "danh sach san pham trong" });
        }

        let items = [];
        let totalAmount = 0;

        for (let requestItem of requestItems) {
            let { product: productId, quantity } = requestItem;

            // kiểm tra sản phẩm tồn tại
            let product = await productModel.findOne({
                _id: productId,
                isDeleted: false
            }).session(session);

            if (!product) {
                await session.abortTransaction();
                session.endSession();
                return res.status(404).send({ message: `san pham ${productId} khong ton tai` });
            }

            // kiểm tra tồn kho
            let inventory = await inventoryModel.findOne({
                product: productId
            }).session(session);

            if (!inventory || inventory.stock - inventory.reserved < quantity) {
                await session.abortTransaction();
                session.endSession();
                return res.status(400).send({
                    message: `san pham ${product.title} khong du hang`
                });
            }

            let subtotal = product.price * quantity;
            totalAmount += subtotal;

            items.push({
                product: productId,
                quantity: quantity,
                title: product.title,
                price: product.price,
                subtotal: subtotal
            });

            // cập nhật reserved trong inventory
            inventory.reserved += quantity;
            await inventory.save({ session });
        }

        // tạo reservation với thời hạn 15 phút
        let newReservation = new reservationModel({
            user: req.userId,
            items: items,
            amount: totalAmount,
            status: "actived",
            expiredIn: new Date(Date.now() + 15 * 60 * 1000)
        });
        await newReservation.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.send(newReservation);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).send({ message: error.message });
    }
});

// hủy reservation (trong transaction)
// POST /reservations/cancelReserve/:id
router.post('/cancelReserve/:id', checkLogin, async function (req, res, next) {
    let session = await mongoose.startSession();
    session.startTransaction();
    try {
        let reservation = await reservationModel.findOne({
            _id: req.params.id,
            user: req.userId
        }).session(session);

        if (!reservation) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).send({ message: "reservation not found" });
        }

        if (reservation.status !== "actived") {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).send({
                message: `khong the huy reservation co trang thai: ${reservation.status}`
            });
        }

        // hoàn trả reserved trong inventory
        for (let item of reservation.items) {
            let inventory = await inventoryModel.findOne({
                product: item.product
            }).session(session);

            if (inventory) {
                inventory.reserved = Math.max(0, inventory.reserved - item.quantity);
                await inventory.save({ session });
            }
        }

        // cập nhật trạng thái reservation
        reservation.status = "cancelled";
        await reservation.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.send(reservation);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).send({ message: error.message });
    }
});

module.exports = router;