let jwt = require('jsonwebtoken')
module.exports = {
    checkLogin: function (req, res, next) {
        try {
            let authorizationToken = req.headers.authorization;
            if (!authorizationToken.startsWith("Bearer")) {
                res.status(403).send({
                    message: "ban chua dang nhap"
                })
                return;
            }
            let token = authorizationToken.split(' ')[1];
            let result = jwt.verify(token, 'HUTECH');
            if (result.exp > Date.now()) {
                req.userId = result.id;
                next();
            } else {
                res.status(403).send({
                    message: "ban chua dang nhap"
                })
            }
        } catch (error) {
            res.status(403).send({
                message: "ban chua dang nhap"
            })
            return;
        }
    }
}