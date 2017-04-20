/**
 * Created by lzan13 on 2017/3/21.
 * 封装调用环信 rest 接口模块儿
 */

var EventProxy = require('eventproxy');
// 网络请求框架
var request = require('request');
var Token = require('../proxy/index').Token;

var logger = require('../common/logger');
var tools = require('../common/tools');
// 项目配置文件
var config = require('../app.config.js');

var org_name = config.em_org_name;
var app_name = config.em_app_name;
var baseUrl = config.em_base_url + org_name + "/" + app_name;
// access token
var access_token = '';
// token 过期时间
var deadline = 0;
// 是否已经过期
var isExpires = false;

/**
 * 构建响应体，并将响应结果返回给接口调用者，结果包含状态以及请求得到的数据
 * {
 *    "status": { // 响应状态
 *        "code": 0,
 *        "message": 'Success'
 *    },
 *    "data": {   // 响应的数据
 *        result:result
 *    }
 * }
 */
var result = {status: {code: config.code.no_error, msg: config.msg.success}, data: {}};

/**
 * 封装 rest 请求接口，通过传递请求参数和回调接口，统一由 request 进行发送请求
 * @param options 请求参数
 * @param callback 回调函数
 */
var requestEasemob = function (options, callback) {
    var options = options || {};
    options.uri = baseUrl + options.uri;
    options.json = true;
    request(options, callback)
};

/**
 * 获取 rest token
 * Callback
 * - token, token 内容，包含 access_token 和过期时间
 * @param callback 回调函数
 */
var getToken = function (callback) {
    // 回调代理
    var ep = new EventProxy();

    var currTime = Math.round(new Date().getTime() / 1000);
    // 判断 accessToken 是否可用，防止每次都去重新获取 token
    if (!isExpires) {
        if (access_token === '' || deadline === 0) {
            // 首先从本地查找 token，如果存在且未过期直接返回
            Token.getTokenByName(config.em_access_token, ep.done(function (token) {
                if (token) {
                    if (token.deadline > currTime) {
                        access_token = token.access_token;
                        deadline = token.deadline;
                        result.data = {
                            access_token: access_token,
                            deadline: deadline
                        };
                        return callback(result);
                    }
                }
                return ep.throw({code: config.code.no_permission_action, msg: config.msg.no_permission_action});
            }));
        } else if (access_token !== '' && deadline > currTime) {
            result.status.code = config.code.no_error;
            result.status.msg = config.msg.success;
            result.data = {
                access_token: access_token,
                deadline: deadline
            };
            return callback(result);
        } else {
            return ep.throw({code: config.code.no_permission_action, msg: config.msg.no_permission_action});
        }
    }
    /**
     * 监听失败的回调
     */
    ep.fail(function (error) {
        var client_id = config.em_client_id;
        var client_secret = config.em_client_secret;
        var options = {
            method: 'POST',
            uri: '/token',
            headers: {
                'content-type': 'application/json'
            },
            body: {
                grant_type: 'client_credentials',
                client_id: client_id,
                client_secret: client_secret
            }
        };
        // 进行网络请求，获取新的 token
        requestEasemob(options, function (error, response, body) {
            if (error) {
                // 设置 token 过期状态为 true
                isExpires = true;
                result.status.code = config.code.request_failed;
                result.status.msg = config.msg.request_failed;
                return callback(result);
            }
            // 设置 token 过期状态为 false
            isExpires = false;
            result.status.code = config.code.no_error;
            result.status.msg = config.msg.success;
            // 给全局 token 变量和 deadline 赋值
            result.data.access_token = access_token = body.access_token;
            result.data.deadline = deadline = Math.round(new Date().getTime() / 1000) + body.expires_in;
            // 保存 token 信息到本地
            Token.createAndSaveToken(config.em_access_token, access_token, deadline, function (error, token) {
                if (error) {
                    logger.i('token save failed, because db exception');
                }
                logger.i('token save success');
                return callback(result);
            });
        });
    });
};

/**
 * 创建新账户
 * @param username 账户名
 * @param password 账户密码
 */
var createUser = function (username, password, callback) {
    getToken(function (data) {
        logger.i("获取 token 结果：" + data.data.access_token);
        var options = {
            method: 'POST',
            uri: '/users',
            headers: {
                'content-type': 'application/json',
                'authorization': 'Bearer ' + data.data.access_token
            },
            body: {
                username: username,
                password: password
            }
        };
        requestEasemob(options, function (error, response, body) {
            if (error) {
                logger.e(error);
                result.status.code = config.code.request_failed;
                result.status.msg = config.msg.request_failed;
                result.data = error;
                return callback(result);
            }
            if (response.statusCode !== 200) {
                if (response.statusCode === 401) {
                    isExpires = true;
                    result.status.code = config.code.no_permission_action;
                    result.status.msg = config.msg.no_permission_action;
                    result.data = response.body;
                } else if (response.statusCode === 400 && response.body.error === 'duplicate_unique_property_exists') {
                    result.status.code = config.code.user_already_exist;
                    result.status.msg = config.msg.user_already_exist;
                    result.data = response.body;
                } else {
                    result.status.code = config.code.request_failed;
                    result.status.msg = config.msg.request_failed;
                    result.data = response.body;
                }
                return callback(result);
            } else {
                result.status.code = config.code.no_error;
                result.status.msg = config.msg.success;
                result.data = body;
                return callback(result);
            }
        });
    });
};

/**
 * 更新环信 IM 账户昵称
 * @param username 账户名
 * @param nickname 新昵称
 * @param callback 回调
 */
var updateNickname = function (username, nickname, callback) {
    getToken(function (data) {
        logger.i("获取 token 结果：" + data.data.access_token);
        var options = {
            method: 'PUT',
            uri: '/users/' + username,
            headers: {
                'content-type': 'application/json',
                'authorization': 'Bearer ' + data.data.access_token
            },
            body: {
                nickname: nickname
            }
        };
        requestEasemob(options, function (error, response, body) {
            if (error) {
                logger.e(error);
                result.status.code = config.code.request_failed;
                result.status.msg = config.msg.request_failed;
                result.data = error;
                return callback(result);
            }
            if (response.statusCode !== 200) {
                if (response.statusCode === 401) {
                    isExpires = true;
                    result.status.code = config.code.no_permission_action;
                    result.status.msg = config.msg.no_permission_action;
                    result.data = response.body;
                } else if (response.statusCode === 400 && response.body.error === 'duplicate_unique_property_exists') {
                    result.status.code = config.code.user_already_exist;
                    result.status.msg = config.msg.user_already_exist;
                    result.data = response.body;
                } else {
                    result.status.code = config.code.request_failed;
                    result.status.msg = config.msg.request_failed;
                    result.data = response.body;
                }
                return callback(result);
            } else {
                result.status.code = config.code.no_error;
                result.status.msg = config.msg.success;
                result.data = body;
                return callback(result);
            }
        });
    });
};

/**
 * 环信 IM 实时回调数据接收操作接口
 * @param body 实时回调数据
 * @returns {{callId: string, accept: string, reason: string, security: string}}
 */
var imCallback = function (body) {
    logger.i(body);
    var data = {
        callId: "",        //与环信推送的一致
        accept: "true",    //表明接受了此推送
        reason: "",        //可选，accept为false时使用
        security: ""       //签名。格式如下: MD5（callId+约定的key+"true"），约定key为654321
    };
    data.callId = body.callId;
    data.security = tools.dataToMD5(data.callId + config.em_callback_key + "true");
    logger.i(data);
    return data;
};

exports.imCallback = imCallback;

exports.getToken = getToken;
exports.createUser = createUser;
exports.updateNickname = updateNickname;

